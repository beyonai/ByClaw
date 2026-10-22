/** Opt-in real read-only backend verification; Redis must be the seeded disposable instance. */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { createRedis } from '@byclaw/by-framework'
import { loadAuthorizedByClawResources } from '../lib/catalog.js'
import { createLazyByClawSkillLoader } from '../lib/lazy-skills.js'
import { ByClawSkillRuntime } from '../lib/skill-runtime.js'
import { byClawSkillCacheDir, syncByClawSkill } from '../lib/skill-sync.js'

const dshRoot = process.env.DSH_ROOT ?? process.cwd()
const { default: SkillRegistry } = await import(pathToFileURL(join(dshRoot, 'packages/skill/skill/lib/index.js')))
const toolSkill = await import(pathToFileURL(join(dshRoot, 'packages/skill/tool-skill/lib/index.js')))

assert.equal(process.env.REDIS_HOST, 'byclaw-startup-redis', 'requires isolated test Redis')
const redis = createRedis()
const root = await mkdtemp(join(tmpdir(), 'byclaw-live-skill-'))
const cache = join(root, 'cache')
const builtins = join(root, 'builtin')
await mkdir(cache); await mkdir(builtins)
const ctx = new Context()
let loader, runtime
try {
  let resources = await loadAuthorizedByClawResources({ redis, userCode: process.env.USER_CODE,
    baseUrl: process.env.BYCLAW_DSH_BASE_URL })
  const employee = resources.employees.find(item => item.skills.length === 1)
  assert.ok(employee, 'requires an authorized employee with one associated Skill')
  let versions = 0, downloads = 0
  loader = createLazyByClawSkillLoader({
    loadResources: async () => resources, baseUrl: () => process.env.BYCLAW_DSH_BASE_URL,
    cacheRoot: cache, concurrency: 2, allowFailure: false, timeoutMs: 15000, attempts: 1,
    retryDelayMs: 0, onError() {},
    syncSkill: options => {
      let request = 0
      return syncByClawSkill({ ...options, fetchImpl: (url, init) => {
        if (request++ === 0) versions++; else downloads++
        return fetch(url, init)
      } })
    },
  })
  await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry); await ctx.plugin(SkillRegistry); await ctx.plugin(toolSkill)
  runtime = await ByClawSkillRuntime.install(ctx, { builtinSkillDir: builtins,
    agentSkillRoot: join(root, 'agent-skills'), resolveDeferredTemplate: template => loader.resolve(template) })
  const template = { schemaVersion: 'dsh.agent-template/v1', id: 'live-probe', kind: 'agent',
    name: 'Live probe', description: '', persona: '',
    skills: employee.skills.map(ref => ({ code: ref.code, path: byClawSkillCacheDir(cache, ref.code), ref })),
    source: { system: 'byclaw', resourceId: employee.id, resourceCode: employee.code,
      workerAgentType: 'BYCLAW_DSH', directlyAuthorized: true } }
  ;(await runtime.prepareGeneration([template], cache, cache))()
  assert.equal(versions, 0); assert.equal(downloads, 0); assert.deepEqual(await readdir(cache), [])
  const id = SessionId('live-skill-probe')
  const agentCtx = new Context()
  const agent = { id, session: Session.create(id, [], { version: SESSION_FORMAT_VERSION, id,
    createdAt: 0, isSeeded: false, delegationDepth: 0 }), ctx: agentCtx, options: {}, status: 'idle' }
  const unbind = runtime.bind(agentCtx, agent, template)
  const start = performance.now()
  const list = await ctx.skills.list({ scope: agent })
  assert.equal(list.length, 1); assert.equal(versions, 1); assert.equal(downloads, 1)
  assert.equal(await ctx.skills.get(list[0].name), undefined, 'unbound agents must not see this employee Skill')
  const firstLoadMs = Math.round(performance.now() - start)
  const body = await readFile(join(template.skills[0].path, 'SKILL.md'), 'utf8')
  const call = await ctx.tools.execute({ agent, signal: new AbortController().signal,
    callId: ToolCallId('live-skill'), name: 'skill', arguments: { name: list[0].name } })
  assert.equal(call.isError, false); assert.ok(JSON.stringify(call).length > 100)
  assert.ok(versions >= 2); const afterToolVersions = versions; assert.equal(downloads, 1, 'same version must reuse downloaded content')
  await rm(join(template.skills[0].path, 'SKILL.md'))
  await ctx.skills.get(list[0].name, { scope: agent })
  assert.equal(versions, afterToolVersions + 1); assert.equal(downloads, 2, 'missing content must download again')
  assert.equal(await readFile(join(template.skills[0].path, 'SKILL.md'), 'utf8'), body)
  resources = { ...resources, employees: [] }
  await assert.rejects(ctx.skills.get(list[0].name, { scope: agent }), /no longer authorized/)
  unbind()
  console.log(JSON.stringify({ liveBackend: true, startupRequests: 0, firstLoadMs,
    versionRequests: versions, downloads, skillTool: 'passed', sameVersionReuse: 'passed',
    missingContentRefetch: 'passed', revokedAccess: 'rejected' }))
} catch (error) {
  // Backend errors can contain signed URLs; never print them or business Skill contents.
  console.error(JSON.stringify({ liveSkillVerification: 'failed', kind: error.name,
    stackLocations: String(error.stack).split('\n').slice(1, 4).map(line => line.replace(/\([^)]*\)/g, '(location)')),
    httpStatus: String(error).match(/HTTP\s+(\d+)/)?.[1] ?? null }))
  process.exitCode = 1
} finally {
  runtime?.dispose(); await loader?.close(); await ctx.fiber.dispose(); await redis.quit()
  await rm(root, { recursive: true, force: true })
}
