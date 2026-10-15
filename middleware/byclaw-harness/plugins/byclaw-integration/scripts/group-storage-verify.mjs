/** File/tool scope guards and ordinary member command execution; temporary fixtures only. */
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { GroupStateBoundary } from '../lib/group-state-boundary.js'
import { projectMemberSkill, setActiveMemberSkillRoots } from '../lib/group-skill-resources.js'
import { privateGenerationRoot } from '../lib/generation-paths.js'
import { ByClawSkillRuntime } from '../lib/skill-runtime.js'
import { resolveTeamStateRoot, parseGroupPublicContext, memberTaskContextDeclaration } from '../../agent-teams/lib/index.js'
import { classifyTeamSettlement } from '../../agent-teams/lib/lifecycle.js'
import { isQuiescentTeamSnapshot } from '../lib/session-runtime.js'

const fixture = await mkdtemp(join(tmpdir(), 'byclaw-group-storage-'))
const previousHome = process.env.DSH_HOME
process.env.DSH_HOME = join(fixture, 'runtime-home')
const workspace = join(fixture, 'business')
await mkdir(workspace)
let checks = 0
function check(value, message) { assert(value, message); checks++ }
try {
  const legacy = join(workspace, '.agent-teams')
  await mkdir(join(legacy, 'team'), { recursive: true })
  await writeFile(join(legacy, 'team', 'team.json'), '{"private":"member-persona"}')
  const privateRoot = resolveTeamStateRoot(workspace, '.agent-teams')
  check(relative(workspace, privateRoot).startsWith('..'), 'team runtime must leave the business workspace')
  check(!existsSync(legacy), 'migration must remove the old readable state')
  check((await readFile(join(privateRoot, 'team', 'team.json'), 'utf8')).includes('member-persona'), 'migration preserves complete records')
  check(resolveTeamStateRoot(workspace, './.agent-teams') === privateRoot, 'equivalent logical namespaces retain the same private root')
  check(resolveTeamStateRoot(workspace, '.agent-teams') === privateRoot, 'cold-resume state identity is stable')
  check(resolveTeamStateRoot(fixture, '.agent-teams').includes('byclaw-agent-teams'), 'broad home workspace must remain compatible')
  if (!existsSync('/.agent-teams')) check(resolveTeamStateRoot('/', '.agent-teams').includes('byclaw-agent-teams'), 'root workspace must remain compatible')
  const skillSource = join(privateRoot, 'own-skill')
  await mkdir(skillSource, { recursive: true })
  await writeFile(join(skillSource, 'SKILL.md'), 'Own employee instructions')
  await writeFile(join(skillSource, 'helper.sh'), '#!/bin/sh\nprintf skill-business-output > \"$1\"\n')
  await writeFile(join(skillSource, '.byclaw-hub-skill.json'), JSON.stringify({ version: 'v1', downloadUrl: 'private-cache-url' }))
  const ownSkill = await projectMemberSkill('member', { name: 'own-skill', path: join(skillSource, 'SKILL.md'), resourceBase: { kind: 'directory', path: skillSource } }, 'v1')
  const peerSkill = await projectMemberSkill('peer', { name: 'own-skill', resourceBase: { kind: 'directory', path: skillSource } }, 'v1')
  check(!existsSync(join(ownSkill.resourceBase.path, '.byclaw-hub-skill.json')), 'own resource view excludes cache metadata')
  const publicFile = join(workspace, 'script.txt')
  await writeFile(publicFile, 'user business material')
  const privateFile = join(privateRoot, 'team', 'team.json')
  await symlink(privateFile, join(workspace, 'private-alias.json'))
  const customCache = join(workspace, 'custom-private-skill-cache')
  const generations = privateGenerationRoot(customCache)
  await mkdir(join(generations, '.byclaw-skill-generation-staging'), { recursive: true })
  await mkdir(join(generations, 'custom-private-skill-cache.byClaw-backup-test'), { recursive: true })
  const stagedMetadata = join(generations, '.byclaw-skill-generation-staging', 'others-skills.json')
  const backupMetadata = join(generations, 'custom-private-skill-cache.byClaw-backup-test', 'others-skills.json')
  await writeFile(stagedMetadata, 'private-staged-employee-skills')
  await writeFile(backupMetadata, 'private-backed-up-employee-skills')
  const legacyGeneration = join(workspace, '.byclaw-skill-generation-legacy', 'metadata.json')
  await mkdir(join(workspace, '.byclaw-skill-generation-legacy'), { recursive: true })
  await writeFile(legacyGeneration, 'private-legacy-generation')
  const independentAgentCatalog = join(workspace, 'independent-employee-parent', 'catalog')
  const independentTeamCatalog = join(workspace, 'independent-team-parent', 'catalog')
  const oldAgentCopy = join(workspace, 'independent-employee-parent', '.byclaw-agent-generation-legacy', 'persona.json')
  const oldTeamCopy = join(workspace, 'independent-team-parent', '.byclaw-team-generation-legacy', 'roster.json')
  for (const path of [oldAgentCopy, oldTeamCopy]) { await mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true }); await writeFile(path, 'private-old-agent-team-config') }
  const scopes = new Map([['member', { role: 'member' }], ['captain', { role: 'coordinator' }]])
  const member = { id: 'member', session: { header: { cwd: workspace } } }
  const captain = { id: 'captain', session: { header: { cwd: workspace } } }
  const builtinDir = join(workspace, 'deployment-skills')
  await mkdir(builtinDir)
  const registry = { async list() { return [] }, async snapshot() { return { skills: [], complete: true } }, async get() { return undefined } }
  const skillCtx = { get(name) { return name === 'skills' ? registry : name === 'byclawGroupCoordination' ? { get(id) { return scopes.get(id) } } : undefined },
    systemPrompt: { section() { return () => undefined } },
    effect(setup) { return setup() }, on() { return () => undefined } }
  const skillRuntime = await ByClawSkillRuntime.install(skillCtx, { builtinSkillDir: builtinDir })
  const memberTemplate = { id: 'member-template', source: { resourceId: 'member-template' } }
  const publish = await skillRuntime.prepareGeneration([{ ...memberTemplate, skills: [{ code: 'own-skill', path: skillSource }] }], privateRoot, privateRoot)
  publish()
  const unbindSkill = skillRuntime.bind({ agent: member, effect(setup) { return setup() } }, member, memberTemplate)
  const loadedSkill = await registry.get('own-skill', { scope: member })
  check(loadedSkill.content.includes('Own employee') && loadedSkill.resourceBase.path !== skillSource, 'real scoped registry projects member Skill instructions/resources')
  check((await registry.list({ scope: member }))[0].resourceBase.path === loadedSkill.resourceBase.path, 'catalog and loaded Skill expose the same own resource view')
  check(await registry.get('other-employee-skill', { scope: member }) === undefined, 'real scoped registry never resolves unassociated peer Skills')
  const revokeSkill = await skillRuntime.prepareGeneration([{ ...memberTemplate, skills: [] }], privateRoot, privateRoot)
  revokeSkill()
  check(await registry.get('own-skill', { scope: member }) === undefined, 'generation publication revokes the previous associated Skill')
  unbindSkill(); skillRuntime.dispose()
  setActiveMemberSkillRoots('member', [ownSkill.resourceBase.path])
  setActiveMemberSkillRoots('peer', [peerSkill.resourceBase.path])
  const events = new Map()
  const fs = {
    processPath(target) { return target.targetKey ?? target.displayPath },
    async resolve(path) { return { displayPath: path } },
    async readText(target) { return readFile(target.displayPath, 'utf8') },
    async readByteRange(target, { offset, length }) { return (await readFile(target.targetKey ?? target.displayPath)).subarray(offset, offset + length) },
    async writeText(target, content) { return writeFile(target.displayPath, content) },
  }
  let dispatched = 0
  const subprocess = {
    spawn(spec) { dispatched++; return spawnSync(spec.argv[0], spec.argv.slice(1), { cwd: spec.cwd, env: spec.env, encoding: 'utf8' }) },
    spawnTerminal(spec) { dispatched++; return Promise.resolve(spawnSync(spec.argv[0], spec.argv.slice(1), { cwd: spec.cwd, env: spec.env, encoding: 'utf8' })) },
  }
  const ctx = { get(name) { return name === 'fs' ? fs : name === 'subprocess' ? subprocess : undefined },
    on(name, listener) { events.set(name, listener); return () => events.delete(name) } }
  const boundary = new GroupStateBoundary({ privateRoots: [privateRoot, customCache, independentAgentCatalog, independentTeamCatalog], getScope: id => scopes.get(id) })
  const originalSpawn = subprocess.spawn, originalTerminal = subprocess.spawnTerminal
  const dispose = boundary.install(ctx)
  let presentation
  const disposeMember = boundary.bindMember({ agent: member, tools: { presentAs(mode) { presentation = mode; return () => undefined } } })
  check(presentation === 'native', 'members retain native business tools')
  const body = events.get('tools/execute')
  check((await body({ agent: member }, () => fs.readByteRange({ displayPath: publicFile }, { offset: 0, length: 4 }))).toString() === 'user', 'binary range reads still work on business files')
  await assert.rejects(body({ agent: member }, () => fs.readByteRange({ displayPath: publicFile, targetKey: privateFile }, { offset: 0, length: 4 })), /PRIVATE_STATE_DENIED/); checks++
  check(await body({ agent: member }, () => fs.readText({ displayPath: publicFile })) === 'user business material', 'ordinary files remain readable')
  await body({ agent: member }, () => fs.writeText({ displayPath: publicFile }, 'updated business material'))
  check(await readFile(publicFile, 'utf8') === 'updated business material', 'ordinary files remain writable')
  for (const path of [oldAgentCopy, oldTeamCopy]) { await assert.rejects(body({ agent: member }, () => fs.readText({ displayPath: path })), /PRIVATE_STATE_DENIED/); checks++ }
  await assert.rejects(body({ agent: member }, () => fs.readText({ displayPath: legacyGeneration })), /PRIVATE_STATE_DENIED/); checks++
  await assert.rejects(body({ agent: member }, () => fs.readText({ displayPath: stagedMetadata })), /PRIVATE_STATE_DENIED/); checks++
  await assert.rejects(body({ agent: member }, () => fs.readText({ displayPath: backupMetadata })), /PRIVATE_STATE_DENIED/); checks++
  await assert.rejects(body({ agent: member }, () => fs.readText({ displayPath: privateFile })), /PRIVATE_STATE_DENIED/); checks++
  await assert.rejects(body({ agent: member }, () => fs.readText({ displayPath: join(workspace, 'private-alias.json') })), /PRIVATE_STATE_DENIED/); checks++
  check((await body({ agent: member }, () => fs.readText({ displayPath: ownSkill.path }))).includes('Own employee'), 'member can read its own Skill resource files')
  await assert.rejects(body({ agent: member }, () => fs.readText({ displayPath: loadedSkill.path })), /PRIVATE_STATE_DENIED/); checks++
  await assert.rejects(body({ agent: member }, () => fs.readText({ displayPath: peerSkill.path })), /PRIVATE_STATE_DENIED/); checks++
  await assert.rejects(body({ agent: member }, () => fs.writeText({ displayPath: ownSkill.path }, 'rewrite skill')), /PRIVATE_STATE_DENIED/); checks++
  check((await body({ agent: captain }, () => fs.readText({ displayPath: privateFile }))).includes('member-persona'), 'captain trusted runtime access remains available')
  const denied = await events.get('tools/pre-execute')({ agent: member, name: 'run_code' }, async () => ({ kind: 'allow' }))
  check(denied.kind === 'deny', 'arbitrary in-process code is refused without text scanning')
  check((await events.get('tools/pre-execute')({ agent: member, name: 'session_event_read' }, async () => ({ kind: 'allow' }))).kind === 'deny', 'other-session transcript queries are refused')
  check(subprocess.spawn === originalSpawn && subprocess.spawnTerminal === originalTerminal, 'member boundary leaves subprocess and terminal backends unchanged')
  const command = await body({ agent: member }, () => subprocess.spawn({ argv: ['/bin/sh', '-c', 'printf command-restored'], cwd: workspace }))
  check(command.status === 0 && command.stdout === 'command-restored', 'shell runs without any group isolation dependency')
  const terminal = await body({ agent: member }, () => subprocess.spawnTerminal({ argv: [process.execPath, '-e', 'process.stdout.write(process.env.MEMBER_TEST)'], cwd: workspace, env: { ...process.env, MEMBER_TEST: 'terminal-restored' } }))
  check(terminal.status === 0 && terminal.stdout === 'terminal-restored', 'terminal argv and environment reach the existing backend')
  // Commands now have the backend's ordinary host access, while file APIs above remain scoped.
  const privateCommand = await body({ agent: member }, () => subprocess.spawn({ argv: ['/bin/cat', privateFile], cwd: workspace }))
  check(privateCommand.status === 0 && privateCommand.stdout.includes('member-persona'), 'group-specific OS read isolation has been removed')
  const helper = await body({ agent: member }, () => subprocess.spawn({ argv: ['/bin/sh', join(ownSkill.resourceBase.path, 'helper.sh'), join(workspace, 'skill-output.txt')], cwd: workspace }))
  check(helper.status === 0 && await readFile(join(workspace, 'skill-output.txt'), 'utf8') === 'skill-business-output', 'Skill CLI helpers can execute normally')
  const zip = join(workspace, 'attachment.zip'), output = join(workspace, 'unzipped')
  await writeFile(zip, Buffer.from('UEsDBBQAAAAAAEqoSl0ldybUEwAAABMAAAAVAAAAbmVzdGVkL2F0dGFjaG1lbnQudHh0YnVzaW5lc3MgYXR0YWNobWVudFBLAQIUAxQAAAAAAEqoSl0ldybUEwAAABMAAAAVAAAAAAAAAAAAAACAAQAAAABuZXN0ZWQvYXR0YWNobWVudC50eHRQSwUGAAAAAAEAAQBDAAAARgAAAAAA', 'base64'))
  const unzip = await body({ agent: member }, () => subprocess.spawn({ argv: ['unzip', '-q', zip, '-d', output], cwd: workspace }))
  check(unzip.status === 0 && await readFile(join(output, 'nested/attachment.txt'), 'utf8') === 'business attachment', 'ordinary unzip command extracts attachments without a new tool')
  const grep = await body({ agent: member }, () => subprocess.spawn({ argv: ['grep', 'business', publicFile], cwd: workspace }))
  check(grep.status === 0 && grep.stdout.includes('business'), 'ordinary search subprocess runs')
  check(dispatched === 6, 'all command and terminal calls reach the backend')
  disposeMember(); dispose()
  const realToolsCtx = new Context()
  await realToolsCtx.plugin(SystemPrompt)
  await realToolsCtx.plugin(ToolRuntime)
  let unsafeDispatched = false
  realToolsCtx.tools.register({ name: 'session_event_read', description: 'unsafe cross-session probe', parameters: {},
    output: { schema: { type: 'object', additionalProperties: false, required: ['value'], properties: { value: { type: 'string' } } }, render: (_args, value) => [{ type: 'text', text: value.value }] },
    execute: async () => { unsafeDispatched = true; return { value: 'private-other-session' } } })
  const realMember = { ...member, ctx: realToolsCtx, session: Session.create(SessionId('member'), [], { ...Session.create(SessionId('member')).header, cwd: workspace }) }
  const nativeScope = createScope(realToolsCtx, realMember)
  realMember.ctx = nativeScope.ctx
  const realBoundary = new GroupStateBoundary({ privateRoots: [privateRoot, customCache, independentAgentCatalog, independentTeamCatalog], getScope: id => scopes.get(id) })
  const stopRealBoundary = realBoundary.install(realToolsCtx)
  const nativeMode = realBoundary.bindMember(nativeScope.ctx.extend({ agent: realMember }))
  // An extensible pre-execute listener cannot override the monotonic private-state guard.
  const override = realToolsCtx.on('tools/pre-execute', () => Promise.resolve({ kind: 'allow' }))
  const deniedActual = await realToolsCtx.tools.execute({ name: 'session_event_read', arguments: {}, agent: realMember, callId: ToolCallId('actual-private-probe'), signal: new AbortController().signal })
  check(deniedActual.isError === true && !unsafeDispatched, 'actual native ToolRuntime refuses private tool body even if another pre-execute listener allows it')
  realToolsCtx.tools.register({ name: 'bash', description: 'fixture ordinary command', parameters: {},
    output: { schema: { type: 'object', additionalProperties: false, required: ['value'], properties: { value: { type: 'string' } } }, render: (_args, value) => [{ type: 'text', text: value.value }] },
    execute: async () => { const result = subprocess.spawn({ argv: ['/bin/sh', '-c', 'printf native-command-restored'], cwd: workspace }); assert.equal(result.status, 0); return { value: result.stdout } } })
  const nativeCommand = await realToolsCtx.tools.execute({ name: 'bash', arguments: {}, agent: realMember, callId: ToolCallId('actual-command'), signal: new AbortController().signal })
  check(nativeCommand.isError !== true && JSON.stringify(nativeCommand).includes('native-command-restored'), 'actual member native ToolRuntime can execute ordinary shell tools')
  const deniedCode = await realToolsCtx.tools.execute({ name: 'run_code', arguments: { code: 'return (await import("node:fs/promises")).readFile("private")' }, agent: realMember, callId: ToolCallId('actual-code-probe'), signal: new AbortController().signal })
  check(deniedCode.isError === true, 'actual native ToolRuntime refuses arbitrary Node import code execution')
  override(); stopRealBoundary(); nativeMode(); await nativeScope.dispose()


  const escapeSource = join(privateRoot, 'escaping-skill')
  await mkdir(escapeSource)
  await symlink(privateFile, join(escapeSource, 'escape'))
  await assert.rejects(projectMemberSkill('member', { name: 'escaping-skill', resourceBase: { kind: 'directory', path: escapeSource } }, 'v1'), /symlink escapes/); checks++

  const context = parseGroupPublicContext({ schemaVersion: 'byclaw.group-chat-context/v1', conversationKey: 'g', snapshot: { beforeMessageId: 'latest' },
    messages: [{ messageId: 'public', role: 'assistant', content: '@视频助手 已生成脚本', speaker: { agentName: '视频助手', agentId: 'private-id', persona: 'other-persona' }, resourceList: [{ modelId: 'other-model' }] },
      { messageId: 'recalled', recalled: true, content: 'ignore me' }, { messageId: 'system', usage: 5, content: 'directory update' }] })
  check(context.messages.length === 1, 'public history excludes recalled/system metadata events')
  check(!JSON.stringify(context).includes('other-persona') && !JSON.stringify(context).includes('other-model') && !JSON.stringify(context).includes('private-id'), 'public snapshot drops employee config/directory/routing identity')
  const team = { name: 'team', description: 'old description', summary: { initial: { goal: '用户的视频目标' } }, groupContextSnapshot: context,
    tasks: [{ id: 'upstream', subject: '脚本', status: 'completed', output: '完成脚本' }, { id: 'unrelated', subject: '其他任务', status: 'completed', output: 'unrelated-private-output' }], assistanceRequests: [] }
  const envelope = memberTaskContextDeclaration(team, { id: 'own', subject: '视频', description: '根据脚本渲染视频', dependencies: ['upstream'] })
  check(envelope.includes('用户的视频目标') && envelope.includes('完成脚本') && envelope.includes('publicHistory'), 'spawn gets original goal, completed dependency results and explicit history')
  check(!envelope.includes('unrelated-private-output'), 'spawn receives no unrelated task result')
  const waiting = { id: 'a', status: 'in_progress', assignee: 'employee', dependencies: [], waitingUser: { reason: 'missing_user_input', inputRevision: 'input' } }
  const dependent = { id: 'b', status: 'pending', dependencies: ['a'] }
  const snapshot = { tasks: [waiting, dependent, { id: 'c', status: 'pending', dependencies: ['b'] }] }
  check(!isQuiescentTeamSnapshot({ tasks: [{ status: 'completed' }, { state: 'running' }] }), 'legacy rows without ids retain independent live state')
  check(isQuiescentTeamSnapshot(snapshot), 'missing user input and dependency chain do not hang the current user response')
  check(!isQuiescentTeamSnapshot({ tasks: [...snapshot.tasks, { id: 'live', status: 'in_progress', dependencies: [] }] }), 'another live branch keeps the async gate waiting')
  check(classifyTeamSettlement({ lifecycle: 'running', members: [{ name: 'employee', status: 'working' }], tasks: [waiting, dependent] }) === 'blocked', 'waiting user input is truthful blocked, never completed')
  check(classifyTeamSettlement({ lifecycle: 'running', members: [], tasks: [waiting, dependent, { id: 'live', status: 'in_progress', dependencies: [] }] }) === 'active', 'lifecycle preserves another live branch')
  console.log(`PASS ${checks} scoped file/tool access, ordinary shell/unzip/search/Skill/terminal execution, public context and waiting-input checks`)
} finally {
  if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome
  await rm(fixture, { recursive: true, force: true })
}
