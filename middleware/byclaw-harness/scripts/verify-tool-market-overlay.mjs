import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const r = createRequire('/workspace/apps/cli/package.json')
const { Context } = await import(r.resolve('@deepseek-ai/cordis'))
const { ToolRuntime } = await import(r.resolve('@deepseek-ai/dsh-tools'))
const { ToolEnv } = await import('/opt/byclaw/dsh-managed/profiles/web/node_modules/@byclaw/dsh-tool-env/lib/index.js')
const templates = [
  { templateKey: 'browser', serviceKey: 'byclaw-tools-browser', capabilities: ['process.exec', 'filesystem', 'browser.automation'], enabled: true },
  { templateKey: 'media', serviceKey: 'byclaw-tools-media', capabilities: ['process.exec', 'filesystem', 'media.render'], enabled: true },
]
const ctx = new Context()
ctx.provide('systemPrompt', { tools() {} })
const tools = new ToolRuntime(ctx)
new ToolEnv(ctx, ToolEnv.Config({ backend: 'byclaw-be', stateDir: '/tmp/byclaw-catalog-abi-no-compute', templates,
  byclawBe: { baseUrl: 'http://127.0.0.1:9', userCode: 'fixture', token: 'fixture' },
}))
await new Promise(resolve => setTimeout(resolve, 0))
const names = tools.schemas().map(s => s.name)
for (const name of ['sandbox_templates', 'sandbox_acquire', 'sandbox_exec', 'sandbox_release']) assert(names.includes(name), name)
await ctx.fiber.dispose()
const host = await import('/workspace/scripts/byclaw-multi-host.mjs')
const config = host.readHostConfig({ BYCLAW_MULTI_HOST_TOKEN: 'fixture', BYCLAW_DSH_TOOL_ENV: 'byclaw-be', BYCLAW_TOOL_ENV_BE_BASE_URL: 'http://127.0.0.1:9', BYCLAW_TOOL_ENV_CATALOG: JSON.stringify(templates) })
assert.deepEqual(config.toolEnvCatalog, templates)
const rows = host.composeUserOverlays([{ id: 'byclaw-tool-env' }], 'fixture', '/tmp/fixture', { ...config, env: { BEYOND_TOKEN: 'fixture' } })
assert.deepEqual(rows[0].config.templates, templates)
console.log(JSON.stringify({ abi: true, registeredTools: names, templates: templates.map(t => t.templateKey), computeCreated: false }))
