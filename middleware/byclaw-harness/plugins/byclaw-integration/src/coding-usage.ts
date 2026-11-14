/** Actual per-request usage, measured from native session counters across one CLI invocation. */
export interface CodingTokenUsage {
  input_tokens: number
  output_tokens: number
  cached_input_tokens?: number
}

export function codingTokenUsage(value: unknown): CodingTokenUsage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const count = (item: unknown): item is number => typeof item === 'number' && Number.isSafeInteger(item) && item >= 0
  if (!count(raw.input_tokens) || !count(raw.output_tokens) || !Number.isSafeInteger(raw.input_tokens + raw.output_tokens)) return undefined
  if (raw.cached_input_tokens !== undefined && (!count(raw.cached_input_tokens) || raw.cached_input_tokens > raw.input_tokens)) return undefined
  return { input_tokens: raw.input_tokens, output_tokens: raw.output_tokens,
    ...(raw.cached_input_tokens === undefined ? {} : { cached_input_tokens: raw.cached_input_tokens }) }
}

/** Metadata-only optional observer contract. Never includes prompts, source files or credentials. */
export interface CodingObservation {
  schemaVersion: 1
  userCode: string
  sessionId: string
  messageId: string
  employeeId: string
  traceId: string
  model?: string
  startedAt: number
  finishedAt: number
  status: 'success' | 'error'
  usage?: CodingTokenUsage
  usageComplete: boolean
}
