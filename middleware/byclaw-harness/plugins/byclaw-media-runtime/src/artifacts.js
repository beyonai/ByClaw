import { randomUUID } from 'node:crypto'
import { mkdir, realpath, writeFile, rm } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'

const MAX_ARTIFACT_BYTES = 50 * 1024 * 1024

function mediaExtension(bytes, mimeType, kind) {
  const b = Buffer.from(bytes)
  if (kind === 'image') {
    if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return ['png', 'image/png']
    if (b[0] === 255 && b[1] === 216 && b[2] === 255) return ['jpg', 'image/jpeg']
    if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return ['webp', 'image/webp']
  } else {
    if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE') return ['wav', 'audio/wav']
    if (b[0] === 255 && (b[1] & 246) === 240) return ['aac', 'audio/aac']
    if (b.toString('ascii', 0, 3) === 'ID3' || (b[0] === 255 && (b[1] & 224) === 224)) return ['mp3', 'audio/mpeg']
    if (b.toString('ascii', 0, 4) === 'OggS') return ['ogg', 'audio/ogg']
    if (b.toString('ascii', 0, 4) === 'fLaC') return ['flac', 'audio/flac']
    if (b.toString('ascii', 4, 8) === 'ftyp') return ['m4a', 'audio/mp4']
  }
  throw new Error(`MEDIA_INVALID_ARTIFACT: unsupported ${kind} bytes (${String(mimeType).slice(0, 40)})`)
}

function validateWordTiming(bytes) {
  let value
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { throw new Error('MEDIA_INVALID_WORD_TIMING') }
  if (!value || typeof value !== 'object' || value.schemaVersion !== 1 || value.unit !== 'second'
    || value.granularity !== 'provider-word' || typeof value.text !== 'string' || !Array.isArray(value.words)) {
    throw new Error('MEDIA_INVALID_WORD_TIMING')
  }
  for (const item of value.words) {
    if (!item || typeof item !== 'object' || typeof item.word !== 'string' || !item.word
      || !Number.isFinite(item.startTime) || item.startTime < 0
      || !Number.isFinite(item.endTime) || item.endTime < item.startTime
      || (item.confidence !== undefined && (!Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1))) {
      throw new Error('MEDIA_INVALID_WORD_TIMING')
    }
  }
}

export async function persistAssets(sessionRoot, kind, assets) {
  if (typeof sessionRoot !== 'string' || !isAbsolute(sessionRoot)) throw new Error('MEDIA_SESSION_ROOT_REQUIRED: missing authoritative session_root')
  if (!['image', 'tts', 'asr'].includes(kind)) throw new Error('MEDIA_INVALID_KIND')
  if (!Array.isArray(assets) || !assets.length || assets.length > 8) throw new Error('MEDIA_EMPTY_ARTIFACTS')
  const root = await realpath(sessionRoot)
  const directory = join(root, kind)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  if (await realpath(directory) !== directory) throw new Error('MEDIA_ARTIFACT_DIRECTORY: symlink directory is forbidden')
  const results = []
  try {
    for (const asset of assets) {
      if (!(asset.bytes instanceof Uint8Array) || !asset.bytes.length || asset.bytes.length > MAX_ARTIFACT_BYTES) throw new Error('MEDIA_INVALID_ARTIFACT_SIZE')
      const wordTiming = kind === 'tts' && asset.artifactType === 'word-timing'
      if (asset.artifactType !== undefined && !wordTiming) throw new Error('MEDIA_INVALID_ARTIFACT_TYPE')
      if (wordTiming && asset.mimeType !== 'application/json') throw new Error('MEDIA_INVALID_WORD_TIMING')
      if (wordTiming) validateWordTiming(asset.bytes)
      const [extension, mimeType] = wordTiming ? ['json', 'application/json'] : mediaExtension(asset.bytes, asset.mimeType, kind)
      const filename = `${randomUUID()}.${extension}`
      const file = join(directory, filename)
      if (relative(root, file).startsWith('..' + sep)) throw new Error('MEDIA_ARTIFACT_DIRECTORY')
      await writeFile(file, asset.bytes, { flag: 'wx', mode: 0o600 })
      results.push({ path: join(sessionRoot, kind, filename), mimeType, bytes: asset.bytes.length })
    }
    return results
  } catch (error) {
    await Promise.all(results.map(result => rm(result.path, { force: true })))
    throw error
  }
}
