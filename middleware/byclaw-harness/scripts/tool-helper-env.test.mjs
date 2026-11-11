import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { before, prepare, prepareSource } from './prepare-tool-helper-env.mjs'
import { isDeploymentParameter } from '../plugins/dsh-tool-env/src/deployment-environment.ts'

// The pinned helper assembles this environment before choosing ordinary vs PTY spawn.
const fixture = `function environment(request, process) { ${before} return env; }`
const environment = new Function(`${prepareSource(fixture)}; return environment`)()
const own = { BYCLAW_TOOL_ENV_FORWARDING: '1', REDIS_PASSWORD: 'sandbox-fixture',
  BUSINESS_API_TOKEN: 'business-fixture', EMPTY: '', LANG: 'C.UTF-8',
  BYCLAW_TOOL_ENV_HOST_KEY: 'bootstrap-fixture', BYCLAW_TOOL_ENV_AUTHORIZED_KEY: 'auth-fixture',
  BYCLAW_DSH_TOOL_ENV: 'byclaw-be', BYCLAW_BROWSER_SECRET: 'broker-fixture',
  BYCLAW_BROWSER_SECRET_FD: '3', BYCLAW_BROWSER_LISTEN_FD: '4',
  BYCLAW_MICROVM_PAYLOAD: 'launch-fixture', BYCLAW_COMMAND_PAYLOAD: 'command-fixture' }
const business = { REDIS_PASSWORD: 'sandbox-fixture', BUSINESS_API_TOKEN: 'business-fixture', EMPTY: '', LANG: 'C.UTF-8' }

test('B forwards its environment by default into the common ordinary/terminal assembly', () => {
  for (const terminal of [undefined, {}]) {
    const env = environment({ terminal, env: { USER_CODE: 'u1' } }, { env: own })
    assert.deepEqual(env, { ...business, USER_CODE: 'u1' })
    const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify({password:process.env.REDIS_PASSWORD,business:process.env.BUSINESS_API_TOKEN,bootstrap:process.env.BYCLAW_TOOL_ENV_HOST_KEY,broker:process.env.BYCLAW_BROWSER_SECRET}))'], {
      env: { PATH: process.env.PATH, ...env }, encoding: 'utf8',
    })
    assert.equal(child.status, 0)
    assert.deepEqual(JSON.parse(child.stdout), { password: 'sandbox-fixture', business: 'business-fixture' })
  }
})

test('request env overrides B, preserving empty values and null tombstones', () => {
  assert.deepEqual(environment({ env: { REDIS_PASSWORD: 'request', EMPTY: 'override', LANG: null, EXTRA: '' } }, { env: own }),
    { ...business, REDIS_PASSWORD: 'request', EMPTY: 'override', LANG: undefined, EXTRA: '' })
  assert.deepEqual(environment({ env: { REDIS_PASSWORD: null } }, { env: own }), { ...business, REDIS_PASSWORD: undefined })
  assert.deepEqual(environment({}, { env: { BYCLAW_TOOL_ENV_FORWARDING: '1', REDIS_PASSWORD: '' } }), { REDIS_PASSWORD: '' })
})

test('allowlist selects B forwarding; request entries remain usable and internal entries never pass', () => {
  const policy = JSON.stringify({ allow: ['REDIS_PASSWORD', 'MISSING', 'BYCLAW_TOOL_ENV_HOST_KEY', 'BYCLAW_BROWSER_SECRET'] })
  const env = { ...own, BYCLAW_TOOL_ENV_FORWARD_ENVIRONMENT: policy }
  assert.deepEqual(environment({ env: { BUSINESS_API_TOKEN: 'explicit', BYCLAW_TOOL_ENV_HOST_KEY: 'injected', BYCLAW_BROWSER_SECRET: 'injected' } }, { env }),
    { REDIS_PASSWORD: 'sandbox-fixture', BUSINESS_API_TOKEN: 'explicit' })
  assert.deepEqual(environment({}, { env: { ...own, BYCLAW_TOOL_ENV_FORWARD_ENVIRONMENT: '{"allow":[]}' } }), {})
  assert.deepEqual(environment({ env: { BYCLAW_TOOL_ENV_FORWARD_ENVIRONMENT: 'all', BYCLAW_TOOL_ENV_FORWARDING: '1' } }, { env }), { REDIS_PASSWORD: 'sandbox-fixture' })
  const injected = Object.fromEntries(Object.entries(own).filter(([name]) => !Object.hasOwn(business, name)))
  assert.deepEqual(environment({ env: injected }, { env: own }), business)
})

test('invalid B policy fails closed without printing policy values', () => {
  for (const policy of ['', 'not-json-secret', 'null', '[]', '{}', '{"allow":"all"}', '{"allow":[1]}', '{"allow":["BAD=NAME"]}', '{"allow":[],"extra":true}']) {
    assert.throws(() => environment({}, { env: { ...own, BYCLAW_TOOL_ENV_FORWARD_ENVIRONMENT: policy } }),
      { message: 'Invalid tool sandbox environment forwarding policy' })
  }
})

test('ordinary SSH helper keeps ambient credential scrubbing and caller null semantics', () => {
  assert.deepEqual(environment({}, { env: { REDIS_PASSWORD: 'ambient' } }), {})
  assert.deepEqual(environment({ env: { USER_CODE: null } }, { env: {} }), { USER_CODE: undefined })
})

test('patch is idempotent and fails closed on changed or mixed helper sources', () => {
  const patched = prepareSource(fixture)
  assert.equal(prepareSource(patched), patched)
  for (const source of ['', before + before, patched + before, fixture.replace('const env', 'let env')]) {
    assert.throws(() => prepareSource(source), /Unsupported/)
  }
})

test('build validates both copies before writing and enforces the pinned version', async () => {
  const root = await mkdtemp(join(tmpdir(), 'byclaw-helper-env-'))
  const profile = join(root, 'profile')
  const dirs = [join(root, 'packages/ssh/ssh'), join(profile, 'node_modules/@deepseek-ai/dsh-ssh')]
  try {
    for (const dir of dirs) {
      await mkdir(join(dir, 'lib'), { recursive: true })
      await writeFile(join(dir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-ssh', version: '0.2.1-rc.2' }))
      await writeFile(join(dir, 'lib/helper.js'), fixture)
    }
    await writeFile(join(dirs[1], 'lib/helper.js'), 'unsupported')
    await assert.rejects(prepare(root, profile), /Unsupported/)
    assert.equal(await readFile(join(dirs[0], 'lib/helper.js'), 'utf8'), fixture)
    await writeFile(join(dirs[1], 'lib/helper.js'), fixture)
    await prepare(root, profile)
    await prepare(root, profile)
    assert.equal(await readFile(join(dirs[0], 'lib/helper.js'), 'utf8'), prepareSource(fixture))
    assert.equal(await readFile(join(dirs[1], 'lib/helper.js'), 'utf8'), prepareSource(fixture))
    await writeFile(join(dirs[1], 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-ssh', version: '0.2.2' }))
    await assert.rejects(prepare(root, profile), /Expected/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('host filtering still removes Redis credentials before the request reaches B', async () => {
  const source = await readFile(new URL('../plugins/dsh-tool-env/src/connection.ts', import.meta.url), 'utf8')
  const privatePattern = source.match(/const PRIVATE_ENVIRONMENT = (\/.*\/u)/)[1]
  const hostPattern = source.match(/const HOST_CREDENTIAL_ENVIRONMENT = (\/.*\/u)/)[1]
  const body = source.slice(source.indexOf('export function scrubEnvironment('), source.indexOf('/** True once'))
    .replace('export function scrubEnvironment(params: unknown): unknown', 'function scrubEnvironment(params)')
    .replace('(params as { env?: unknown })', 'params')
  const scrub = new Function('isDeploymentParameter', `const PRIVATE_ENVIRONMENT = ${privatePattern}; const HOST_CREDENTIAL_ENVIRONMENT = ${hostPattern}; ${body}; return scrubEnvironment`)(isDeploymentParameter)
  const request = scrub({ env: { REDIS_PASSWORD: 'host-fixture', REDIS_CLUSTER_PASSWORD: 'cluster-fixture',
    BYCLAW_TOOL_ENV_FORWARDING: '1', BYCLAW_TOOL_ENV_FORWARD_ENVIRONMENT: 'all',
    PLATFORM_API_TOKEN: 'host-token', BYCLAW_DEPLOY_PRIVATE_KEY: 'deployment-fixture',
    BYCLAW_DEPLOY_HOST: 'deployment.invalid', BEYOND_TOKEN: 'user-token' } })
  assert.deepEqual(request.env, { BEYOND_TOKEN: 'user-token' })
  assert.deepEqual(environment(request, { env: own }), { ...business, BEYOND_TOKEN: 'user-token' })
})

for (const name of ['Dockerfile', 'Dockerfile.extensions', 'Dockerfile.slim']) {
  test(`${name} patches workspace and profile helpers before derived tools capture their hashes`, async () => {
    const source = await readFile(new URL('../' + name, import.meta.url), 'utf8')
    assert.ok(source.includes('COPY --chown=byclaw:byclaw middleware/byclaw-harness/scripts/prepare-tool-helper-env.mjs'))
    assert.ok(source.includes('node scripts/prepare-tool-helper-env.mjs /workspace "${BYCLAW_DSH_MANAGED_HOME}/profiles/web"'))
    if (name === 'Dockerfile.slim') assert.ok(source.includes('COPY --from=profile-builder --chown=byclaw:byclaw /workspace/packages/ssh/ssh/lib/'))
  })
}

async function sessionConfig(policy) {
  const source = await readFile(new URL('../plugins/dsh-tool-env/scripts/tool-env-sshd.sh', import.meta.url), 'utf8')
  const python = source.split("| python3 -c '\n")[1].split("\n' >")[0]
  return spawnSync('python3', ['-c', python], {
    env: { PATH: process.env.PATH, ...(policy === undefined ? {} : { BYCLAW_TOOL_ENV_FORWARD_ENVIRONMENT: policy }) },
    input: 'REDIS_PASSWORD=sandbox-fixture\nBYCLAW_BROWSER_SECRET=broker-fixture\nBYCLAW_TOOL_ENV_HOST_KEY=bootstrap-fixture\nBYCLAW_TOOL_ENV_FORWARDING=caller-value\nBYCLAW_TOOL_ENV_FORWARD_ENVIRONMENT=caller-policy\n',
    encoding: 'utf8',
  })
}

test('tool sshd excludes startup credentials and mints B-only forwarding policy on one SetEnv line', async () => {
  const config = await sessionConfig()
  assert.equal(config.status, 0)
  assert.match(config.stdout, /"REDIS_PASSWORD=sandbox-fixture"/)
  assert.match(config.stdout, /"BYCLAW_TOOL_ENV_FORWARDING=1"/)
  assert.doesNotMatch(config.stdout, /bootstrap-fixture|broker-fixture|caller-value|caller-policy/)
  assert.equal(config.stdout.trim().split('\n').length, 1)
  const allow = await sessionConfig('{"allow":["REDIS_PASSWORD"]}')
  assert.equal(allow.status, 0)
  assert.ok(allow.stdout.includes('allow'))
  assert.ok(allow.stdout.includes('REDIS_PASSWORD'))
})

test('tool sshd rejects invalid startup policy without logging its value', async () => {
  for (const policy of ['invalid-secret', 'null', '{"allow":["BAD=NAME"]}', '{"allow":[],"extra":true}']) {
    const config = await sessionConfig(policy)
    assert.notEqual(config.status, 0)
    assert.equal(config.stdout, '')
    assert.ok(config.stderr.trim().endsWith('Invalid tool sandbox environment forwarding policy'))
    assert.ok(!config.stderr.includes(policy))
  }
})
