export interface MediaModel {
  id: string
  provider: string
  protocol: string
  model: string
  endpoint: string
  apiKey: string
  headers: Record<string, string>
  options: Record<string, any>
  timeoutMs: number
}
export interface MediaAsset { bytes: Uint8Array; mimeType: string; artifactType?: 'word-timing' }
export interface RequestContext { signal?: AbortSignal; fetch?: typeof fetch }
export function resolveMediaModel(redis: { hget(key: string, field: string): Promise<string | null> }, type: 'IMAGE_GENERATION' | 'TTS', options?: { decrypt?: (value: string) => string; modelId?: string }): Promise<MediaModel>
export function endpoint(base: string, suffix: string): string
export function request(url: string, init?: RequestInit, context?: RequestContext, options?: { acceptErrorResponse?: boolean }): Promise<Response>
export function readBytes(response: Response, maxBytes?: number, signal?: AbortSignal): Promise<Buffer>
export function readJson(response: Response, maxBytes?: number): Promise<any>
export function assetFromBase64(value: string, mimeType: string): MediaAsset
export function downloadAsset(value: string, context?: RequestContext): Promise<MediaAsset>
/** Infrastructure-only: resolve and validate once, then pin TLS connection lookups. Never expose resolver as model/tool configuration. */
export function resolveDownloadLookup(hostname: string, resolver?: (hostname: string, options: { all: true }) => Promise<Array<{ address: string; family: number }>>): Promise<import('node:net').LookupFunction>
export function pollDelay(ms: number, signal?: AbortSignal): Promise<void>
export const MAX_MEDIA_BYTES: number
export function persistAssets(root: string, kind: 'image' | 'tts', assets: MediaAsset[]): Promise<Array<{ path: string; mimeType: string; bytes: number }>>
export function mountMediaPlugin(ctx: any, options: { kind: 'image' | 'tts'; generate: (model: MediaModel, args: any, context: RequestContext) => Promise<MediaAsset[]>; modelId?: string; provider?: string; protocol?: string }): void
