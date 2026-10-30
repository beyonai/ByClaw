import { constants } from 'node:fs'
import { open, realpath, writeFile, rename, unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'

const referencePattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}\.(png|jpe?g|webp)$/i
const MAX_REFERENCE_BYTES = 10 * 1024 * 1024

/** Accept the same virtual path used by COMMON_FILE, within this session only. */
export function imageReferenceId(reference, sessionId) {
  if (typeof reference !== 'string') throw new Error('IMAGE_REFERENCE_INVALID')
  if (referencePattern.test(reference)) return reference
  const id = basename(reference)
  if (!referencePattern.test(id) || ![`/.sessions/${sessionId}/image/${id}`, `/by/.sessions/${sessionId}/image/${id}`].includes(reference)) {
    throw new Error('IMAGE_REFERENCE_INVALID')
  }
  return id
}

/**
 * References are opaque filenames in this session, never arbitrary paths or URLs.
 * `io` reads a session tree that is not on this machine (see the tool's `host.artifactIo`).
 */
export async function loadImageReference(root, id, io) {
  if (typeof id !== 'string' || !referencePattern.test(id)) throw new Error('IMAGE_REFERENCE_INVALID')
  if (io) {
    try {
      const directory = join(await io.realpath(root), 'image')
      if (await io.realpath(directory) !== directory) throw new Error('directory')
      const bytes = Buffer.from(await io.readBytes(join(directory, id), MAX_REFERENCE_BYTES))
      if (bytes.length < 12) throw new Error('size')
      return { bytes, mimeType: referenceMimeType(id) }
    } catch { throw new Error('IMAGE_REFERENCE_INVALID') }
  }
  let handle
  try {
    const canonical = await realpath(root)
    const directory = join(canonical, 'image')
    if (await realpath(directory) !== directory) throw new Error('directory')
    handle = await open(join(directory, id), constants.O_RDONLY | constants.O_NOFOLLOW)
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size < 12 || stat.size > MAX_REFERENCE_BYTES) throw new Error('size')
    const bytes = Buffer.alloc(stat.size)
    let offset = 0
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (!read.bytesRead) throw new Error('truncated')
      offset += read.bytesRead
    }
    return { bytes, mimeType: referenceMimeType(id) }
  } catch { throw new Error('IMAGE_REFERENCE_INVALID') }
  finally { await handle?.close() }
}

function referenceMimeType(id) {
  return /\.png$/i.test(id) ? 'image/png' : /\.webp$/i.test(id) ? 'image/webp' : 'image/jpeg'
}

function dimensions(bytes, mimeType) {
  if (mimeType === 'image/png' && bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  }
  if (mimeType === 'image/jpeg') {
    let offset = 2
    while (offset + 9 < bytes.length && bytes[offset] === 0xff) {
      const marker = bytes[offset + 1]
      if ([0xc0, 0xc1, 0xc2].includes(marker)) return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) }
      const length = bytes.readUInt16BE(offset + 2)
      if (length < 2) break
      offset += 2 + length
    }
  }
  if (mimeType === 'image/webp' && bytes.length >= 30 && bytes.toString('ascii', 8, 12) === 'WEBP') {
    const type = bytes.toString('ascii', 12, 16)
    if (type === 'VP8X') return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) }
    if (type === 'VP8 ') return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff }
    if (type === 'VP8L') {
      const bits = bytes.readUInt32LE(21)
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) }
    }
  }
  return {}
}

/**
 * A sidecar persists version lineage independently of the model's final prose.
 * `remote` writes it into a session tree that is not on this machine; the image
 * bytes it just stored there (`sources`, in artifact order) give the dimensions.
 */
export async function describeImageArtifacts(root, artifacts, args, sessionId, remote) {
  const result = []
  for (const [index, artifact] of artifacts.entries()) {
    const id = basename(artifact.path)
    let size
    if (remote) size = dimensions(Buffer.from(remote.sources[index].bytes).subarray(0, 65536), artifact.mimeType)
    else {
      // Generated images may exceed the reference limit; read only enough for metadata.
      const handle = await open(artifact.path, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const buffer = Buffer.alloc(65536)
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
        size = dimensions(buffer.subarray(0, bytesRead), artifact.mimeType)
      } finally { await handle.close() }
    }
    const metadata = { schemaVersion: 1, id,
      path: sessionId ? `/by/.sessions/${sessionId}/image/${id}` : artifact.path,
      title: args.prompt.trim().slice(0, 120), mimeType: artifact.mimeType, bytes: artifact.bytes, ...size,
      ...(args.referenceImage ? { parentId: args.referenceImage } : {}) }
    if (remote) {
      await remote.io.writeReplace(join(await remote.io.realpath(root), 'image', `${id}.artifact.json`), Buffer.from(JSON.stringify(metadata)))
      result.push(metadata)
      continue
    }
    const target = join(await realpath(root), 'image', `${id}.artifact.json`)
    const temporary = `${target}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, JSON.stringify(metadata), { flag: 'wx', mode: 0o600 })
      await rename(temporary, target)
    } finally { await unlink(temporary).catch(() => {}) }
    result.push(metadata)
  }
  return result
}
