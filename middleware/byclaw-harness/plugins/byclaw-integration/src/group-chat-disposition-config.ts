/** Environment-only connection override for the independent group-chat classifier. */

/** Complete OpenAI-compatible connection, kept outside conversation and result payloads. */
export interface GroupChatDispositionModelConfig {
  readonly baseUrl: string
  readonly apiKey: string
  readonly model: string
}

/** Resolve an independent connection when all required settings are present.
 * @param environment - Deployment environment captured by the classifier.
 * @returns A complete connection, or undefined when all three settings are blank.
 * @throws When only part of the connection is configured or its URL is unusable.
 */
export function resolveGroupChatDispositionModelConfig(environment: Readonly<Record<string, string | undefined>>): GroupChatDispositionModelConfig | undefined {
  const baseUrl = environment['BYCLAW_GROUP_CHAT_DISPOSITION_BASE_URL']?.trim() ?? ''
  const apiKey = environment['BYCLAW_GROUP_CHAT_DISPOSITION_API_KEY']?.trim() ?? ''
  const model = environment['BYCLAW_GROUP_CHAT_DISPOSITION_MODEL']?.trim() ?? ''
  if (!baseUrl && !apiKey && !model) return undefined
  if (!baseUrl || !apiKey || !model) throw new Error('BYCLAW_GROUP_CHAT_DISPOSITION_BASE_URL, BYCLAW_GROUP_CHAT_DISPOSITION_API_KEY and BYCLAW_GROUP_CHAT_DISPOSITION_MODEL must be configured together')
  let url: URL
  try { url = new URL(baseUrl) } catch (error: unknown) {
    throw new Error('BYCLAW_GROUP_CHAT_DISPOSITION_BASE_URL must be an HTTP(S) URL', { cause: error })
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('BYCLAW_GROUP_CHAT_DISPOSITION_BASE_URL must be an HTTP(S) base URL without credentials, query or fragment')
  return { baseUrl, apiKey, model }
}
