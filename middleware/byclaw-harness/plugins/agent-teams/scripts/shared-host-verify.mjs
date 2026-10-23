/** Shared-host isolation: per-context team state, tool-environment workspaces and Claude members. */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../lib/index.js'
import {
  bindTeamStateRuntime, defaultTeamStateRuntime, registerTeamStateWorkspaceAlias, resolveTeamStateRoot,
  teamStateRuntime, TeamStateRuntime,
} from '../lib/runtime-state.js'
import { defaultCatalogDir, listRuntimeInstances } from '../lib/catalog.js'
import { readClaudeMemberState, runClaudeTurn } from '../lib/claude-bridge.js'
import { findTeamByCaptain } from '../lib/state.js'

const root = await mkdtemp(join(tmpdir(), 'agent-teams-shared-host-'))
// The workspace exists only on each user's tool environment, never on this host.
const WORKSPACE = '/by'
assert.equal(existsSync(WORKSPACE), false, 'verification needs /by to be absent on this host')

function fakeContext(subprocess) {
  const definitions = new Map()
  const services = new Map([['subprocess', subprocess]])
  const ctx = {
    root: {},
    effect(setup) { return setup() },
    on() { return () => {} },
    provide(name, value) { services.set(name, value) },
    get(name) { return services.get(name) },
    tools: { register(tool) { definitions.set(tool.name, tool) } },
    systemPrompt: { section() { return () => {} } },
    agents: { get() { return undefined } },
    llm: { async resolveCallConfig(config) { return config } },
    subagents: {
      getProvider() { return undefined }, list() { return [] },
      async listChildren() { return [] }, async listDescendants() { return [] }, interrupt() {},
    },
    logger: { debug() {}, info() {}, warn() {} },
  }
  return { ctx, definitions }
}

function captain(id, cwd = WORKSPACE) {
  return {
    id, status: 'idle', options: { provider: 'p', model: 'm' },
    session: {
      header: cwd === null ? {} : { cwd }, snapshotEvents() { return [] }, ownEvents() { return [] }, append() {},
      requestHeader() { return { config: { provider: 'p', model: 'm' } } },
    },
  }
}

const call = (definitions, agent, name, args) => definitions.get(`agent_teams_${name}`).execute(args, {
  agent, signal: new AbortController().signal,
})

console.log('dsh-agent-teams shared-host verification')
try {
  // 1. Two contexts in one process, same workspace path, separate team databases.
  const homes = { alice: join(root, 'users', 'alice', 'dsh-home'), bob: join(root, 'users', 'bob', 'dsh-home') }
  const users = {}
  for (const [name, dshHome] of Object.entries(homes)) {
    const { ctx, definitions } = fakeContext(undefined)
    apply(ctx, { stateDir: '.agent-teams', memberProvider: 'spawn', dshHome, workspaceOnToolEnvironment: true, controlledWorkflow: true, maxTaskAttempts: 3 })
    users[name] = { ctx, definitions, runtime: teamStateRuntime(ctx) }
  }
  assert.notEqual(users.alice.runtime, users.bob.runtime)
  assert.notEqual(users.alice.runtime, defaultTeamStateRuntime)
  const aliceRoot = users.alice.runtime.resolveTeamStateRoot(WORKSPACE, '.agent-teams')
  const bobRoot = users.bob.runtime.resolveTeamStateRoot(WORKSPACE, '.agent-teams')
  assert.notEqual(aliceRoot, bobRoot)
  assert.ok(aliceRoot.startsWith(join(homes.alice, 'runtime', 'byclaw-agent-teams')), aliceRoot)
  assert.ok(bobRoot.startsWith(join(homes.bob, 'runtime', 'byclaw-agent-teams')), bobRoot)
  // Same identity hash as the host-local layout, just under the user's own home.
  assert.equal(aliceRoot.slice(-64), bobRoot.slice(-64))

  const aliceCaptain = captain('alice-captain')
  const bobCaptain = captain('bob-captain')
  const created = await call(users.alice.definitions, aliceCaptain, 'create', { name: 'Alice team', description: 'alice goal' })
  assert.equal((await findTeamByCaptain(aliceRoot, 'alice-captain'))?.id, created.team_id)
  assert.equal(await findTeamByCaptain(bobRoot, 'alice-captain'), undefined, 'bob cannot see alice team state')
  await assert.rejects(call(users.bob.definitions, aliceCaptain, 'status', {}), /not lead or belong|not leading/)
  await call(users.bob.definitions, bobCaptain, 'create', { name: 'Bob team', description: 'bob goal' })
  const aliceInstances = await listRuntimeInstances(defaultCatalogDir(homes.alice), users.alice.runtime)
  const bobInstances = await listRuntimeInstances(defaultCatalogDir(homes.bob), users.bob.runtime)
  assert.deepEqual(aliceInstances.map(instance => [instance.teamName, instance.status]), [['Alice team', 'active']])
  assert.deepEqual(bobInstances.map(instance => [instance.teamName, instance.status]), [['Bob team', 'active']])
  assert.equal(existsSync(join(WORKSPACE, '.agent-teams')), false, 'nothing was written to a host /by')
  console.log('  PASS  two contexts with the same workspace path keep separate team state and catalogs')

  // 2. Workspace aliases are per context: no cross-user conflict or cross-wiring.
  const releaseAlice = users.alice.runtime.registerWorkspaceAlias('/by/s/new', '/by/s/alice-old')
  const releaseBob = users.bob.runtime.registerWorkspaceAlias('/by/s/new', '/by/s/bob-old')
  assert.equal(users.alice.runtime.resolveTeamStateRoot('/by/s/new', '.agent-teams'), users.alice.runtime.resolveTeamStateRoot('/by/s/alice-old', '.agent-teams'))
  assert.equal(users.bob.runtime.resolveTeamStateRoot('/by/s/new', '.agent-teams'), users.bob.runtime.resolveTeamStateRoot('/by/s/bob-old', '.agent-teams'))
  assert.notEqual(resolveTeamStateRoot('/by/s/new', '.agent-teams'), resolveTeamStateRoot('/by/s/alice-old', '.agent-teams'), 'default runtime is untouched')
  assert.throws(() => users.alice.runtime.registerWorkspaceAlias('/by/s/new', '/by/s/other'), /Conflicting/)
  releaseAlice(); releaseBob()
  console.log('  PASS  workspace aliases are scoped per context')

  // 3. Tool-environment paths are opaque strings; host-local mode keeps realpath.
  const real = join(root, 'real'); const link = join(root, 'link')
  await mkdir(real); await symlink(real, link)
  const remote = new TeamStateRuntime({ dshHome: join(root, 'remote-home'), workspaceOnToolEnvironment: true })
  assert.equal(remote.workspacePath(link), link, 'no host realpath for a tool-environment workspace')
  assert.equal(remote.workspacePath('/by/a/../b/'), '/by/b')
  assert.equal(defaultTeamStateRuntime.workspacePath(link), real, 'host-local mode still canonicalizes')
  assert.throws(() => remote.workspaceOf(captain('x', null)), /no workspace is configured/)
  assert.equal(new TeamStateRuntime({ workspaceOnToolEnvironment: true, workspace: '/by' }).workspaceOf(captain('x', null)), '/by')
  assert.equal(defaultTeamStateRuntime.workspaceOf(captain('x', null)), process.cwd())
  console.log('  PASS  tool-environment workspaces never touch the host filesystem')

  // 4. Defaults are unchanged: unbound contexts and plain configs use the process-wide runtime.
  const plain = fakeContext(undefined)
  apply(plain.ctx, { stateDir: '.agent-teams', memberProvider: 'spawn', maxTaskAttempts: 3 })
  assert.equal(teamStateRuntime(plain.ctx), defaultTeamStateRuntime)
  assert.equal(teamStateRuntime({ root: {} }), defaultTeamStateRuntime)
  const legacyAlias = registerTeamStateWorkspaceAlias(join(root, 'ws-new'), join(root, 'ws-old'))
  assert.equal(defaultTeamStateRuntime.resolveTeamStateRoot(join(root, 'ws-new'), '.agent-teams'), resolveTeamStateRoot(join(root, 'ws-old'), '.agent-teams'))
  legacyAlias()
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = join(root, 'env-home')
  try {
    assert.equal(defaultCatalogDir(), join(root, 'env-home', 'agent-teams'))
    assert.equal(defaultCatalogDir(homes.alice), join(homes.alice, 'agent-teams'), 'explicit dshHome wins over DSH_HOME')
    assert.ok(resolveTeamStateRoot(join(root, 'ws'), '.agent-teams').startsWith(join(root, 'env-home', 'runtime', 'byclaw-agent-teams')))
    assert.ok(users.alice.runtime.resolveTeamStateRoot(WORKSPACE, '.agent-teams').startsWith(homes.alice), 'bound runtime ignores DSH_HOME')
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  }
  const unbind = bindTeamStateRuntime(plain.ctx, remote)
  assert.equal(teamStateRuntime(plain.ctx), remote)
  unbind()
  assert.equal(teamStateRuntime(plain.ctx), defaultTeamStateRuntime)
  console.log('  PASS  default placement is unchanged without explicit config')

  // 5. Claude members run through ctx.subprocess with only explicit env.
  const spawns = []
  const subprocess = {
    spawn(spec) {
      spawns.push(spec)
      const text = JSON.stringify({ session_id: 'claude-session-1', result: 'done remotely', is_error: false })
      return {
        done: Promise.resolve({ exitCode: 0, signal: null }),
        collected: { stdout: { readFrom: () => ({ text }) }, stderr: { readFrom: () => ({ text: '' }) } },
      }
    },
  }
  const previousKey = process.env.ANTHROPIC_API_KEY
  process.env.ANTHROPIC_API_KEY = 'host-secret'
  try {
    const stateDir = join(root, 'claude-state')
    const turn = await runClaudeTurn({
      prompt: 'work', cwd: WORKSPACE, stateDir, teamId: 'team', memberName: 'coder',
      claudeBin: '/usr/local/bin/claude', env: { ANTHROPIC_BASE_URL: 'https://proxy.example' }, subprocess: () => subprocess,
    })
    assert.equal(turn.isError, false)
    assert.equal(turn.result, 'done remotely')
    assert.equal(spawns.length, 1)
    assert.deepEqual(spawns[0].argv, ['/usr/local/bin/claude', '-p', 'work', '--output-format', 'json'])
    assert.equal(spawns[0].cwd, WORKSPACE)
    assert.deepEqual(spawns[0].env, { ANTHROPIC_BASE_URL: 'https://proxy.example' }, 'no host credentials reach the tool environment')
    assert.equal(readClaudeMemberState(stateDir, 'team', 'coder').sessionId, 'claude-session-1')
    await runClaudeTurn({ prompt: 'again', cwd: WORKSPACE, stateDir, teamId: 'team', memberName: 'coder', subprocess: () => subprocess })
    assert.deepEqual(spawns[1].argv, ['claude', '-p', 'again', '--output-format', 'json', '--resume', 'claude-session-1'])
    assert.deepEqual(spawns[1].env, {})
    const missing = await runClaudeTurn({ prompt: 'x', cwd: WORKSPACE, stateDir, teamId: 'team', memberName: 'other', claudeBin: process.execPath, subprocess: () => undefined })
    assert.equal(missing.isError, true)
    assert.match(missing.result, /no subprocess provider/, 'a missing tool environment never falls back to the host')
    const failing = { spawn: () => ({ done: Promise.resolve({ exitCode: 2, signal: null }), collected: { stdout: { readFrom: () => ({ text: '' }) }, stderr: { readFrom: () => ({ text: 'boom' }) } } }) }
    const failed = await runClaudeTurn({ prompt: 'x', cwd: WORKSPACE, stateDir, teamId: 'team', memberName: 'other', subprocess: () => failing })
    assert.equal(failed.isError, true)
    assert.match(failed.result, /exit 2: boom/)
  } finally {
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = previousKey
  }
  console.log('  PASS  Claude members run through the tool environment with only explicit env')

  // 6. Plugin config wires the bound context's subprocess into the scheduler's Claude bridge.
  const wired = fakeContext(subprocess)
  apply(wired.ctx, { stateDir: '.agent-teams', memberProvider: 'spawn', dshHome: join(root, 'users', 'carol', 'dsh-home'), workspaceOnToolEnvironment: true, claudeEnv: { ANTHROPIC_AUTH_TOKEN: 'carol-token' }, maxTaskAttempts: 3 })
  assert.equal(teamStateRuntime(wired.ctx).options.dshHome, join(root, 'users', 'carol', 'dsh-home'))
  const carol = captain('carol-captain')
  wired.ctx.agents.get = id => id === carol.id ? carol : undefined
  await call(wired.definitions, carol, 'create', { name: 'Carol team', description: 'carol goal' })
  await call(wired.definitions, carol, 'add_member', { name: 'coder', runtime: 'claude-code' })
  const before = spawns.length
  await call(wired.definitions, carol, 'create_task', { subject: 'write code', assignee: 'coder' })
  for (let index = 0; index < 100 && spawns.length === before; index++) await new Promise(done => setTimeout(done, 20))
  assert.equal(spawns.length, before + 1, 'the scheduler ran the claude member through ctx.subprocess')
  assert.equal(spawns.at(-1).cwd, WORKSPACE)
  assert.deepEqual(spawns.at(-1).env, { ANTHROPIC_AUTH_TOKEN: 'carol-token' })
  const pointerFile = (await listRuntimeInstances(defaultCatalogDir(homes.alice), users.alice.runtime))[0]
  assert.ok(JSON.parse(await readFile(join(defaultCatalogDir(homes.alice), 'instances', `${pointerFile.id}.json`), 'utf8')).stateRoot.startsWith(homes.alice))
  console.log('  PASS  plugin config routes scheduled Claude members through the bound tool environment')
} finally {
  await rm(root, { recursive: true, force: true })
}
console.log('\nall shared-host checks passed')
