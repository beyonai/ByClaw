/** CodeGraph MCP usage policy for DeepSeek Harness Agents. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'

/** Cordis plugin name. */
export const name = 'dsh-codegraph'

/** Services required to contribute model guidance. */
export const inject = ['systemPrompt']

const POLICY = `## CodeGraph

This runtime provides CodeGraph through the \`mcp__codegraph__codegraph_explore\` tool. CodeGraph is a tree-sitter-parsed graph of project files, symbols, and relationships.

Use the authoritative cwd from the current runtime context as \`projectPath\` on every CodeGraph call. Do not rely on the MCP process directory, and do not substitute another checkout.

Use \`mcp__codegraph__codegraph_explore\` for structural questions: architecture, onboarding, symbol lookup, source inspection, end-to-end flows, callers and callees, or change-impact analysis. Put the complete question in \`query\`; name the relevant file or symbol when known. Prefer one focused call and make another only when the first result exposes a distinct unresolved area.

Use native text search for literal strings, comments, and log messages, or after opening a specific file. Do not repeat a successful CodeGraph structural lookup with grep. Allow about one second for the index watcher after writes.

If CodeGraph reports that the selected project is not initialized, ask the user before running \`codegraph init -i\` unless an explicitly authorized initialization workflow owns that operation. Index-health checks use the \`codegraph status\` CLI because a separate status tool is not part of the configured MCP surface.`

/** Return the model-visible CodeGraph usage policy. */
export function codeGraphPolicy(): string {
  return POLICY
}

/** Register the global policy inherited by root and delegated Agents. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'codegraph:usage-policy',
    order: 117,
    text: POLICY,
  }), 'dsh-codegraph.system-prompt')
}
