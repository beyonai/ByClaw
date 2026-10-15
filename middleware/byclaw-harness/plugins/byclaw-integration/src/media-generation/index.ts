import { randomUUID } from 'node:crypto'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

import { modelFetch } from '../model-fetch.ts'
import { generateOpenAiImage } from './providers/openai-image.ts'
import { generateVolcengineTtsV3 } from './providers/volcengine-tts-v3.ts'
import {
  mediaConfigurationRequiredResult,
  MediaSystemDefaultUnavailableError,
  resolveMediaModelFromProjection,
  resolveMediaProjectionPath,
  withMediaRetry,
  type MediaCapability,
  type ResolvedMediaModel,
} from './runtime-config.ts'
import { loadSystemDefaultMediaModel, type MediaModelRedis } from './system-model.ts'

interface MediaRuntimeOptions {
  redis: MediaModelRedis
}

async function mediaModel(options: MediaRuntimeOptions, capability: MediaCapability): Promise<ResolvedMediaModel> {
  return resolveMediaModelFromProjection({
    capability,
    projectionPath: resolveMediaProjectionPath(capability),
    loadSystemDefault: () => loadSystemDefaultMediaModel(options.redis, capability),
  })
}

async function saveArtifact(workspace: string, kind: 'image' | 'audio', bytes: Buffer, mimeType: string) {
  if (bytes.length === 0 || bytes.length > 50 * 1024 * 1024) throw new Error('MEDIA_ARTIFACT_INVALID')
  const root = join(workspace, '.generated-media')
  await mkdir(root, { recursive: true, mode: 0o700 })
  const extension = mimeType === 'audio/wav' ? 'wav'
    : mimeType === 'audio/ogg' ? 'ogg' : mimeType.startsWith('audio/') ? 'mp3'
      : mimeType === 'image/jpeg' ? 'jpg' : 'png'
  const path = join(root, `${kind}-${randomUUID()}.${extension}`)
  const temporary = `${path}.tmp`
  await writeFile(temporary, bytes, { mode: 0o600 })
  await rename(temporary, path)
  return { kind, path, mimeType, byteSize: bytes.length }
}

function configurationRequired(capability: MediaCapability, error: unknown) {
  return { json: JSON.stringify(mediaConfigurationRequiredResult(capability, error)) }
}

export function registerMediaGenerationTools(ctx: Context, options: MediaRuntimeOptions): void {
  ctx.tools.register(defineTool({
    name: 'image_generate',
    description: 'Generate images with the enabled user image connector, otherwise the system default image model. Returns connector setup guidance when neither is usable.',
    parameters: {
      prompt: { type: 'string', required: true }, negativePrompt: { type: 'string' },
      width: { type: 'number' }, height: { type: 'number' },
      count: { type: 'number' }, seed: { type: 'number' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { json: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.json }],
    },
    execute: async (args, exec) => {
      if (exec.agent === undefined) throw new Error('image_generate requires a calling agent session')
      const workspace = exec.agent.session.header.cwd
      if (workspace === undefined) throw new Error('image_generate requires an agent workspace')
      let model: ResolvedMediaModel
      try {
        model = await mediaModel(options, 'IMAGE')
      } catch (error) {
        if (error instanceof MediaSystemDefaultUnavailableError) return configurationRequired('IMAGE', error.cause)
        throw error
      }
      if (model.modelProtocol !== 'OPENAI_IMAGE') {
        if (model.source === 'system-default') return configurationRequired('IMAGE', new Error('MEDIA_ADAPTER_NOT_FOUND'))
        throw new Error('MEDIA_ADAPTER_NOT_FOUND')
      }
      let generated: Awaited<ReturnType<typeof generateOpenAiImage>>
      try {
        generated = await withMediaRetry(model, () => generateOpenAiImage({
          model, request: args, signal: exec.signal,
          fetchImpl: modelFetch(model.connectTimeoutSeconds * 1000, model.readTimeoutSeconds * 1000),
        }))
      } catch (error) {
        if (model.source === 'system-default') return configurationRequired('IMAGE', error)
        throw error
      }
      const artifacts = await Promise.all(generated.map(image => saveArtifact(workspace, 'image', image.bytes, image.mimeType)))
      return { json: JSON.stringify({ source: model.source, model: model.modelName, artifacts }) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'speech_generate',
    description: 'Synthesize speech with the enabled user TTS connector, otherwise the system default TTS model. Returns connector setup guidance when neither is usable.',
    parameters: {
      text: { type: 'string', required: true }, voice: { type: 'string' },
      speed: { type: 'number' }, format: { type: 'string' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { json: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.json }],
    },
    execute: async (args, exec) => {
      if (exec.agent === undefined) throw new Error('speech_generate requires a calling agent session')
      const workspace = exec.agent.session.header.cwd
      if (workspace === undefined) throw new Error('speech_generate requires an agent workspace')
      let model: ResolvedMediaModel
      try {
        model = await mediaModel(options, 'TTS')
      } catch (error) {
        if (error instanceof MediaSystemDefaultUnavailableError) return configurationRequired('TTS', error.cause)
        throw error
      }
      if (model.modelProtocol !== 'VOLCENGINE_TTS_V3') {
        if (model.source === 'system-default') return configurationRequired('TTS', new Error('MEDIA_ADAPTER_NOT_FOUND'))
        throw new Error('MEDIA_ADAPTER_NOT_FOUND')
      }
      let generated: Awaited<ReturnType<typeof generateVolcengineTtsV3>>
      try {
        generated = await withMediaRetry(model, () => generateVolcengineTtsV3({
          model,
          request: {
            text: args.text,
            ...(args.voice === undefined ? {} : { voice: args.voice }),
            ...(args.speed === undefined ? {} : { speed: args.speed }),
            ...(args.format === 'wav' || args.format === 'ogg' || args.format === 'mp3' ? { format: args.format } : {}),
          },
          signal: exec.signal,
          fetchImpl: modelFetch(model.connectTimeoutSeconds * 1000, model.readTimeoutSeconds * 1000),
        }))
      } catch (error) {
        if (model.source === 'system-default') return configurationRequired('TTS', error)
        throw error
      }
      const artifact = await saveArtifact(workspace, 'audio', generated.bytes, generated.mimeType)
      return { json: JSON.stringify({ source: model.source, model: model.modelName, artifact, providerRequestId: generated.providerRequestId }) }
    },
  }))
}
