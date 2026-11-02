import { randomUUID } from 'node:crypto'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { SpeechWordTiming } from './providers/volcengine-tts-v3.ts'
import type { ToolEnvironmentFiles } from '../tool-environment-files.ts'

async function writeArtifact(path: string, content: Buffer | string, files?: ToolEnvironmentFiles): Promise<number> {
  if (files !== undefined) {
    // `ctx.fs` writes text only; bytes go through the tool environment's subprocess.
    if (typeof content === 'string') await files.writeText(path, content)
    else await files.writeBytes(path, content)
    return Buffer.byteLength(content)
  }
  const temporary = `${path}.tmp`
  await writeFile(temporary, content, { mode: 0o600 })
  await rename(temporary, path)
  return Buffer.byteLength(content)
}

async function artifactRoot(workspace: string, files?: ToolEnvironmentFiles): Promise<string> {
  const root = join(workspace, '.generated-media')
  if (files !== undefined) await files.ensureDirectory(root)
  else await mkdir(root, { recursive: true, mode: 0o700 })
  return root
}

export async function saveMediaArtifact(
  workspace: string,
  kind: 'image' | 'audio',
  bytes: Buffer,
  mimeType: string,
  files?: ToolEnvironmentFiles,
) {
  if (bytes.length === 0 || bytes.length > 50 * 1024 * 1024) throw new Error('MEDIA_ARTIFACT_INVALID')
  const root = await artifactRoot(workspace, files)
  const extension = mimeType === 'audio/wav' ? 'wav'
    : mimeType === 'audio/ogg' ? 'ogg' : mimeType.startsWith('audio/') ? 'mp3'
      : mimeType === 'image/jpeg' ? 'jpg' : 'png'
  const path = join(root, `${kind}-${randomUUID()}.${extension}`)
  await writeArtifact(path, bytes, files)
  return { kind, path, mimeType, byteSize: bytes.length }
}

export async function saveWordTimingArtifact(
  workspace: string,
  words: readonly SpeechWordTiming[],
  metadata: { text: string, providerRequestId?: string },
  files?: ToolEnvironmentFiles,
) {
  const root = await artifactRoot(workspace, files)
  const path = join(root, `word-timing-${randomUUID()}.json`)
  const content = `${JSON.stringify({
    schemaVersion: 1,
    unit: 'second',
    granularity: 'provider-word',
    text: metadata.text,
    ...(metadata.providerRequestId === undefined ? {} : { providerRequestId: metadata.providerRequestId }),
    words,
  }, null, 2)}\n`
  const byteSize = await writeArtifact(path, content, files)
  return { kind: 'word-timing', path, mimeType: 'application/json', byteSize }
}
