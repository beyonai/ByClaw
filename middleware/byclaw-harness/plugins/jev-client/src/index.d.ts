export interface JevConfig { apiKey: string; baseURL: string; model: string; timeoutMs: number }
export interface JevOptions {
  env?: Record<string, string | undefined>
  config?: JevConfig
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  onRequest?: (input: { model: string; state: unknown; questions: unknown }) => void
}
export type JevChoiceResult = { status: 'selected'; choice: string; confidence: number; probabilities: Record<string, number>; model: string; usage?: { input_tokens?: number; output_tokens?: number } }
  | { status: 'unavailable'; reason: string }
export declare function enabled(value?: string): boolean
export declare function resolveJevConfig(env?: Record<string, string | undefined>): JevConfig
export declare function selectWithJev(state: unknown, criteria: Record<string, unknown>, instructions: string, options?: JevOptions): Promise<JevChoiceResult>

export interface JevChoiceAnswer { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> }
export interface JevQuestion { type: 'choice'; criteria: Record<string, unknown>; instructions: string }
export declare function validateJevChoice(answer: unknown, criteria: Record<string, unknown>): answer is JevChoiceAnswer
export declare function askChoicesWithJev(state: unknown, questions: Record<string, JevQuestion>, options?: JevOptions): Promise<
  { status: 'answered'; answers: Record<string, unknown>; model: string; usage?: { input_tokens?: number; output_tokens?: number } }
  | { status: 'unavailable'; reason: string }>
