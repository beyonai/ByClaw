import { assetFromBase64, downloadAsset, readJson, request } from '@byclaw/media-runtime'

export function rejectOption(args, key) {
  if (args[key] !== undefined) throw new Error(`IMAGE_UNSUPPORTED_OPTION: ${key}`)
}

export function singleImage(args) {
  if ((args.count ?? 1) !== 1) throw new Error('IMAGE_UNSUPPORTED_OPTION: this route supports count=1')
}

export function dimensions(size) {
  const match = /^(\d{2,5})x(\d{2,5})$/.exec(size ?? '')
  if (!match) throw new Error('IMAGE_INVALID_SIZE: expected WIDTHxHEIGHT')
  const [width, height] = match.slice(1).map(Number)
  if (width < 64 || height < 64 || width > 16384 || height > 16384) throw new Error('IMAGE_INVALID_SIZE')
  return { width, height }
}

export function pick(options, keys) {
  return Object.fromEntries(keys.filter(key => options?.[key] !== undefined).map(key => [key, options[key]]))
}

export function headers(model, auth = 'bearer') {
  const result = new Headers(model.headers ?? {})
  result.set('Content-Type', 'application/json')
  if (model.apiKey) {
    if (auth === 'google') result.set('x-goog-api-key', model.apiKey)
    else if (auth === 'azure') result.set('api-key', model.apiKey)
    else result.set('Authorization', `${auth === 'fal' ? 'Key' : 'Bearer'} ${model.apiKey}`)
  }
  return result
}

export async function jsonRequest(url, model, body, context, auth) {
  const response = await request(url, { method: body === undefined ? 'GET' : 'POST', headers: headers(model, auth), ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, context)
  // Inline base64 images are larger than binary media. Bound the entire JSON too.
  const result = await readJson(response, 70 * 1024 * 1024)
  if (!result || typeof result !== 'object' || result.error || result.code || (result.base_resp?.status_code !== undefined && result.base_resp.status_code !== 0)) throw new Error('IMAGE_PROVIDER_FAILED')
  return result
}

export async function imageList(entries, context) {
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 8) throw new Error('IMAGE_EMPTY_OR_EXCESS_OUTPUT')
  const assets = []
  for (const entry of entries) {
    context.signal?.throwIfAborted()
    if (!entry || entry.error) throw new Error('IMAGE_PROVIDER_FAILED')
    const value = typeof entry === 'string' ? entry : entry.url
    const asset = entry.b64_json
      ? assetFromBase64(entry.b64_json, entry.media_type ?? entry.mimeType ?? 'image/png')
      : await downloadAsset(value, context)
    assets.push(validateImage(asset))
  }
  return assets
}

// Verify complete containers before exposing bytes; final persistence also validates media.
export function validateImage(asset) {
  const b = Buffer.from(asset.bytes)
  let mimeType
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    let offset = 8
    let header = false
    let pixels = false
    while (offset + 12 <= b.length) {
      const length = b.readUInt32BE(offset)
      const kind = b.toString('ascii', offset + 4, offset + 8)
      if (offset + length + 12 > b.length) break
      if (kind === 'IHDR' && length === 13 && b.readUInt32BE(offset + 8) > 0 && b.readUInt32BE(offset + 12) > 0) header = true
      if (kind === 'IDAT' && length > 0) pixels = true
      offset += length + 12
      if (kind === 'IEND' && length === 0 && header && pixels && offset === b.length) mimeType = 'image/png'
    }
  } else if (completeJpeg(b)) {
    mimeType = 'image/jpeg'
  } else if (completeWebp(b)) {
    mimeType = 'image/webp'
  }
  if (!mimeType) throw new Error('IMAGE_INVALID_MEDIA: malformed, truncated or unsupported image')
  return { bytes: asset.bytes, mimeType }
}

function completeJpeg(bytes) {
  if (bytes[0] !== 255 || bytes[1] !== 216) return false
  let offset = 2
  let frame = false
  let scan = false
  while (offset < bytes.length) {
    if (bytes[offset++] !== 255) return false
    while (bytes[offset] === 255) offset++
    const marker = bytes[offset++]
    if (marker === 217) return frame && scan && offset === bytes.length
    if (marker === 0 || marker === 216 || offset + 2 > bytes.length) return false
    const length = bytes.readUInt16BE(offset)
    if (length < 2 || offset + length > bytes.length) return false
    if ([192, 193, 194].includes(marker)) {
      if (length < 11 || bytes.readUInt16BE(offset + 3) === 0 || bytes.readUInt16BE(offset + 5) === 0) return false
      const components = bytes[offset + 7]
      if (![1, 3, 4].includes(components) || length !== 8 + 3 * components) return false
      frame = true
    }
    offset += length
    if (marker === 218) {
      if (!frame || length < 6) return false
      const start = offset
      while (offset < bytes.length) {
        if (bytes[offset] !== 255) { offset++; continue }
        const next = bytes[offset + 1]
        if (next === 0 || (next >= 208 && next <= 215)) { offset += 2; continue }
        break
      }
      if (offset === start) return false
      scan = true
    }
  }
  return false
}

function completeWebp(bytes) {
  if (bytes.length < 30 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP' || bytes.readUInt32LE(4) + 8 !== bytes.length) return false
  let image = false
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const kind = bytes.toString('ascii', offset, offset + 4)
    const length = bytes.readUInt32LE(offset + 4)
    const start = offset + 8
    if (start + length + (length % 2) > bytes.length) return false
    if (kind === 'VP8 ') {
      if (length < 11 || bytes[start] & 1 || !bytes.subarray(start + 3, start + 6).equals(Buffer.from([157, 1, 42])) || !(bytes.readUInt16LE(start + 6) & 16383) || !(bytes.readUInt16LE(start + 8) & 16383)) return false
      image = true
    } else if (kind === 'VP8L') {
      if (length < 6 || bytes[start] !== 47 || (bytes[start + 4] >> 5) !== 0) return false
      image = true
    } else if (kind === 'VP8X') {
      if (length !== 10 || bytes[start] & 2) return false // Animated outputs are outside this contract.
    } else if (!['ALPH', 'ICCP', 'EXIF', 'XMP '].includes(kind)) return false
    offset = start + length + (length % 2)
  }
  return image && offset === bytes.length
}

export function pollSettings(model) {
  const interval = model.options?.pollIntervalMs ?? (model.provider === 'VYDRA' ? 5000 : 1000)
  const attempts = model.options?.maxPollAttempts ?? 300
  if (!Number.isInteger(interval) || interval < 1 || interval > 30000 || !Number.isInteger(attempts) || attempts < 1 || attempts > 1000) throw new Error('IMAGE_INVALID_POLL_CONFIG')
  return { interval, attempts }
}
