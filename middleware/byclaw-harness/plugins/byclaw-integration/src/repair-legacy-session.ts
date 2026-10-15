/** Safe, idempotent repair for legacy ByClaw events in DSH JSONL+Zstandard artifacts. */

import { randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { copyFile, open, readFile, rename, rm, stat } from 'node:fs/promises'
import { constants as zlibConstants, zstdCompress, zstdDecompress, type ZstdOptions } from 'node:zlib'
import {
  BYCLAW_ROOT_BINDING_EVENT,
  BYCLAW_SESSION_WORKSPACE_EVENT,
} from './session-workspace.ts'

export type JsonRecord = Record<string, unknown>

interface ZstdFrameRange {
  readonly start: number
  readonly end: number
}

export interface LegacySessionRepairResult {
  readonly path: string
  readonly scannedEvents: number
  readonly changedEvents: number
  readonly applied: boolean
  readonly backupPath?: string
}

const CHECKSUM_OPTIONS: ZstdOptions = {
  params: { [zlibConstants.ZSTD_c_checksumFlag]: 1 },
}

// Mirrors DSH master's structural frame walk so each concatenated frame is
// decoded independently. Node's one-shot zstdDecompress intentionally stops
// after the first frame.
function scanZstdFrames(buffer: Buffer): ZstdFrameRange[] {
  const frames: ZstdFrameRange[] = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) throw new Error(`corrupt Zstandard session log: torn frame at byte ${start}`)
    if (buffer.readUInt32LE(offset) !== 0xFD2FB528) {
      throw new Error(`corrupt Zstandard session log: invalid frame magic at byte ${offset}`)
    }
    offset += 4
    if (offset === buffer.length) throw new Error(`corrupt Zstandard session log: torn frame at byte ${start}`)
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 0x18) !== 0) {
      throw new Error(`corrupt Zstandard session log: reserved frame-header bit at byte ${offset - 1}`)
    }
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const dictionaryFlag = descriptor & 0x03
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) {
      throw new Error(`corrupt Zstandard session log: torn frame header at byte ${start}`)
    }
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) throw new Error(`corrupt Zstandard session log: torn block at byte ${start}`)
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 0x03
      const blockSize = blockHeader >>> 3
      if (blockType === 0x03) {
        throw new Error(`corrupt Zstandard session log: reserved block type at byte ${offset - 3}`)
      }
      const payloadBytes = blockType === 0x01 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) throw new Error(`corrupt Zstandard session log: torn block at byte ${start}`)
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) throw new Error(`corrupt Zstandard session log: torn checksum at byte ${start}`)
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  if (frames.length === 0) throw new Error('corrupt Zstandard session log: no complete frames')
  return frames
}

function compressFrame(input: Buffer | string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zstdCompress(input, CHECKSUM_OPTIONS, (error, result) => {
      if (error !== null) reject(error)
      else resolve(result)
    })
  })
}

function decompressFrame(input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zstdDecompress(input, (error, result) => {
      if (error !== null) reject(error)
      else resolve(result)
    })
  })
}

function parseJsonRecord(line: string, index: number): JsonRecord {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch (error: unknown) {
    throw new Error(`corrupt DSH JSONL session log: line ${index + 1} is not valid JSON`, { cause: error })
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`corrupt DSH JSONL session log: line ${index + 1} is not an object`)
  }
  return value as JsonRecord
}

/** Decode every complete frame while retaining each JSON record byte-for-byte. */
export async function decodeZstdJsonlLines(source: Buffer): Promise<string[]> {
  const ranges = scanZstdFrames(source)
  const plaintext = Buffer.concat(await Promise.all(ranges.map(({ start, end }) => (
    decompressFrame(source.subarray(start, end))
  ))))
  if (plaintext.length === 0 || plaintext.at(-1) !== 0x0A) {
    throw new Error('corrupt DSH JSONL session log: stream must end with a newline')
  }
  const decoded = plaintext.toString('utf8')
  if (!Buffer.from(decoded, 'utf8').equals(plaintext)) {
    throw new Error('corrupt DSH JSONL session log: stream is not valid UTF-8')
  }
  const lines = decoded.slice(0, -1).split('\n')
  if (lines.some(line => line === '')) throw new Error('corrupt DSH JSONL session log: empty record line')
  const records = lines.map(parseJsonRecord)
  if (records[0]?.['type'] !== 'session') throw new Error('corrupt DSH JSONL session log: first record is not a session header')
  return lines
}

/** Decode every complete frame and parse the complete newline-delimited record stream. */
export async function decodeZstdJsonlArtifact(source: Buffer): Promise<JsonRecord[]> {
  return (await decodeZstdJsonlLines(source)).map(parseJsonRecord)
}

/** Encode exact JSONL lines as one independently-decodable header and event frame. */
export async function encodeZstdJsonlLines(lines: readonly string[]): Promise<Buffer> {
  const records = lines.map(parseJsonRecord)
  if (records.length === 0 || records[0]?.['type'] !== 'session') {
    throw new Error('cannot encode DSH JSONL session log without a session header')
  }
  const header = `${lines[0]}\n`
  const events = lines.slice(1).join('\n')
  const [headerFrame, eventFrame] = await Promise.all([
    compressFrame(header),
    compressFrame(events === '' ? '' : `${events}\n`),
  ])
  return Buffer.concat([headerFrame, eventFrame])
}

/** Encode parsed records. Intended for fixtures; repairs use the lossless line encoder. */
export async function encodeZstdJsonlArtifact(records: readonly JsonRecord[]): Promise<Buffer> {
  return encodeZstdJsonlLines(records.map(record => JSON.stringify(record)))
}

function injectIgnorable(line: string, index: number): string {
  const objectEnd = line.trimEnd().length - 1
  if (objectEnd < 0 || line[objectEnd] !== '}') {
    throw new Error(`corrupt DSH JSONL session log: line ${index + 1} is not a JSON object`)
  }
  return `${line.slice(0, objectEnd)},"ignorable":true${line.slice(objectEnd)}`
}

/** Mark audited legacy envelopes while preserving all pre-existing JSON text exactly. */
export function markLegacyByClawLinesIgnorable(lines: readonly string[]): {
  lines: string[]
  changedEvents: number
} {
  let changedEvents = 0
  const transformed = lines.map((line, index) => {
    const record = parseJsonRecord(line, index)
    if (index === 0 || record['ignorable'] === true
      || (record['type'] !== BYCLAW_SESSION_WORKSPACE_EVENT && record['type'] !== BYCLAW_ROOT_BINDING_EVENT)) {
      return line
    }
    changedEvents += 1
    return injectIgnorable(line, index)
  })
  return { lines: transformed, changedEvents }
}

/** Mark only the two audited legacy event envelopes as safe to omit. */
export function markLegacyByClawEventsIgnorable(records: readonly JsonRecord[]): {
  records: JsonRecord[]
  changedEvents: number
} {
  let changedEvents = 0
  const transformed = records.map((record, index) => {
    if (index === 0 || record['ignorable'] === true
      || (record['type'] !== BYCLAW_SESSION_WORKSPACE_EVENT && record['type'] !== BYCLAW_ROOT_BINDING_EVENT)) {
      return record
    }
    changedEvents += 1
    return { ...record, ignorable: true }
  })
  return { records: transformed, changedEvents }
}

/** Inspect or atomically repair one compressed DSH session artifact. */
export async function repairLegacySessionArtifact(
  path: string,
  options: { apply?: boolean } = {},
): Promise<LegacySessionRepairResult> {
  const source = await readFile(path)
  const decoded = await decodeZstdJsonlLines(source)
  const transformed = markLegacyByClawLinesIgnorable(decoded)
  const base = {
    path,
    scannedEvents: Math.max(0, decoded.length - 1),
    changedEvents: transformed.changedEvents,
  }
  if (transformed.changedEvents === 0 || options.apply !== true) return { ...base, applied: false }

  const targetStat = await stat(path)
  const temporaryPath = `${path}.byclaw-repair-${process.pid}-${randomUUID()}.tmp`
  const backupPath = `${path}.byclaw-backup-${new Date().toISOString().replace(/[:.]/gu, '-')}`
  try {
    const encoded = await encodeZstdJsonlLines(transformed.lines)
    const handle = await open(temporaryPath, 'wx', targetStat.mode)
    try {
      await handle.writeFile(encoded)
      await handle.sync()
    } finally {
      await handle.close()
    }
    const validated = await decodeZstdJsonlLines(await readFile(temporaryPath))
    if (validated.length !== transformed.lines.length
      || validated.some((line, index) => line !== transformed.lines[index])) {
      throw new Error('temporary ByClaw session repair did not round-trip exactly')
    }
    const latestSource = await readFile(path)
    if (!latestSource.equals(source)) {
      throw new Error('ByClaw session artifact changed while repair was prepared; retry after stopping DSH')
    }
    await copyFile(path, backupPath, fsConstants.COPYFILE_EXCL)
    await rename(temporaryPath, path)
    return { ...base, applied: true, backupPath }
  } catch (error: unknown) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}
