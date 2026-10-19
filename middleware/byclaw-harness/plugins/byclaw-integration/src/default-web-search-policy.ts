/** Prevent DSH's built-in search from bypassing ByClaw connector policy. */

const DEFAULT_DSH_WEB_SEARCH_TOOL = 'web_search'
const DENIAL_REASON = 'Default DSH web_search is disabled by ByClaw policy. Use the deepseek-web-search Skill.'

interface GuardableTools {
  guard(check: (execution: Readonly<{ name: string }>) => string | undefined): () => void
}

/**
 * Install a monotonic guard instead of relying only on bundle configuration.
 * Web agent presets may register a scoped tool-web instance after startup; a
 * global guard still applies to those registrations and cannot be overridden.
 */
export function installDefaultWebSearchPolicy(tools: GuardableTools): () => void {
  return tools.guard(execution => execution.name === DEFAULT_DSH_WEB_SEARCH_TOOL
    ? DENIAL_REASON
    : undefined)
}
