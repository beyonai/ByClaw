/** Real local HTTP + ZIP preparation; no platform credentials or model calls. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, readFile, rm, copyFile, symlink } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { prepareAgentSkills } from './prepare-agent-skills.mjs'

function zip(files) {
  const program = 'import io,json,sys,zipfile\nb=io.BytesIO()\nwith zipfile.ZipFile(b,"w") as z:\n for name,text in json.loads(sys.argv[1]).items(): z.writestr(name,text)\nsys.stdout.buffer.write(b.getvalue())'
  return execFileSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', program, JSON.stringify(files)])
}
const skillText = (name, content = 'test body', extra = '') => `---\nname: ${name}\ndescription: Test skill\n${extra}---\n${content}\n`
const ref = (id = 9, code = 'document-organizer') => ({ resourceId: id, resourceCode: code, resourceBizType: 'SKILL' })

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'agent-skills-verify-'))
  const builtin = join(root, 'builtin')
  await mkdir(join(builtin, 'builtin-demo'), { recursive: true })
  await writeFile(join(builtin, 'builtin-demo', 'SKILL.md'), skillText('builtin-demo'))
  const state = { bindings: { 1001: [ref()], 1002: [] }, version: '1', queries: [], versions: 0, downloads: 0,
    status: 200, downloadStatus: 200, failure: false, inner: false, external: false,
    payload: zip({ 'document-organizer/SKILL.md': skillText('document-organizer'), 'document-organizer/scripts/read.mjs': '// fixture' }) }
  const server = createServer(async (request, response) => {
    assert.equal(request.headers['beyond-token'], 'fixture-auth')
    assert.equal(request.headers['x-user-id'], 'fixture-user')
    assert.equal(request.headers['sso-token'], 'fixture-sso')
    response.statusCode = state.status
    if (state.status !== 200) { response.end('failed'); return }
    const url = new URL(request.url, 'http://localhost')
    if (url.pathname.endsWith('/queryRelResourceInfo')) {
      let body = ''
      for await (const chunk of request) body += chunk
      const id = JSON.parse(body).resourceId
      state.queries.push(id)
      response.end(JSON.stringify({ success: !state.failure, code: state.failure ? -1 : 0, data: state.bindings[id] }))
    } else if (url.pathname.endsWith('/getSkillVersion')) {
      state.versions++
      response.end(JSON.stringify({ code: 0, data: { version: state.version,
        skillType: state.inner ? 'inner' : 'hub', needDownload: !state.inner,
        ...(state.external ? { skillUrl: 'https://unconfigured.example/skill.zip' } : {}) } }))
    } else if (url.pathname.endsWith('/downloadSkillZip')) {
      state.downloads++
      response.statusCode = state.downloadStatus
      response.end(state.payload)
    } else {
      response.statusCode = 404
      response.end()
    }
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  t.after(async () => { await new Promise(done => server.close(done)); await rm(root, { recursive: true, force: true }) })
  const environment = { BYCLAW_SKILLS_DIR: builtin, BYAI_SERVICE_BASE_URL: `http://127.0.0.1:${server.address().port}/byaiService`,
    USER_CODE: 'fixture-user', BEYOND_TOKEN: 'fixture-auth', SSO_TOKEN: 'fixture-sso' }
  const options = { agentId: '1001', byRoot: root, environment }
  return { root, state, options, builtin }
}

test('downloads full associated Skill; repeats query/version but reuses cached ZIP; updates changed version', async t => {
  const { options, state } = await fixture(t)
  const first = await prepareAgentSkills(options)
  assert.deepEqual(first.map(skill => skill.name), ['builtin-demo', 'document-organizer'])
  const document = first.find(skill => skill.name === 'document-organizer')
  assert.equal(await readFile(join(document.path, '..', 'scripts', 'read.mjs'), 'utf8'), '// fixture')
  assert.equal(state.downloads, 1)
  assert.deepEqual(await prepareAgentSkills(options), first)
  assert.equal(state.versions, 2, 'one version check per task, not two')
  assert.equal(state.downloads, 1, 'same version never redownloads')
  state.version = '2'
  state.payload = zip({ 'SKILL.md': skillText('document-organizer', 'updated') })
  await prepareAgentSkills(options)
  assert.equal(state.downloads, 2)
  assert.match(await readFile(document.path, 'utf8'), /updated/u)
})

test('same reused sandbox resolves each agent and removes revoked associations from the effective view', async t => {
  const { options, state } = await fixture(t)
  await prepareAgentSkills(options)
  assert.deepEqual((await prepareAgentSkills({ ...options, agentId: '1002' })).map(skill => skill.name), ['builtin-demo'])
  state.bindings[1001] = []
  assert.deepEqual((await prepareAgentSkills(options)).map(skill => skill.name), ['builtin-demo'])
  assert.deepEqual(state.queries, ['1001', '1002', '1001'])
  assert.equal(state.downloads, 1)
})

test('inner associations use the image; associated content overrides a builtin with the same name', async t => {
  const { options, state, builtin } = await fixture(t)
  state.bindings[1001] = [ref(7, 'builtin-demo')]
  state.inner = true
  assert.equal((await prepareAgentSkills(options))[0].path, join(builtin, 'builtin-demo', 'SKILL.md'))
  assert.equal(state.downloads, 0)
  state.inner = false
  state.payload = zip({ 'SKILL.md': skillText('builtin-demo', 'associated override', 'disable-model-invocation: true\n') })
  const skills = await prepareAgentSkills(options)
  assert.equal(skills.length, 1)
  assert.equal(skills[0].enabled, false)
  assert.match(await readFile(skills[0].path, 'utf8'), /associated override/u)
})

test('failed query/auth/version never silently uses an older associated set', async t => {
  const { options, state } = await fixture(t)
  await prepareAgentSkills(options)
  state.failure = true
  await assert.rejects(prepareAgentSkills(options), /EXECUTION_SKILL_REQUEST_FAILED/u)
  state.failure = false
  state.status = 401
  await assert.rejects(prepareAgentSkills(options), /EXECUTION_SKILL_AUTH_FAILED/u)
  state.status = 200
  state.version = ''
  await assert.rejects(prepareAgentSkills(options), /EXECUTION_SKILL_INVALID_VERSION/u)
  await assert.rejects(prepareAgentSkills({ ...options, environment: { ...options.environment, BEYOND_TOKEN: '' } }), /AUTH_MISSING/u)
})

test('rejects unsafe codes, archives, external download URLs and ambiguous names', async t => {
  const { options, state } = await fixture(t)
  state.bindings[1001] = [ref(9, '../outside')]
  await assert.rejects(prepareAgentSkills(options), /unsafe ByClaw Skill code/u)
  state.bindings[1001] = [ref()]
  state.payload = zip({ '../escape': 'bad', 'SKILL.md': skillText('document-organizer') })
  await assert.rejects(prepareAgentSkills(options), /unsafe ByClaw Skill ZIP/u)
  state.external = true
  await assert.rejects(prepareAgentSkills(options), /origin is not configured/u)
  state.external = false
  state.payload = zip({ 'SKILL.md': skillText('document-organizer') })
  state.bindings[1001] = [ref(9), ref(10, 'another-code')]
  await assert.rejects(prepareAgentSkills(options), /EXECUTION_SKILL_NAME_CONFLICT/u)
})

test('accepts published code-version names and fails if an inner Skill is absent from the image', async t => {
  const { options, state } = await fixture(t)
  state.payload = zip({ 'SKILL.md': skillText('document-organizer-v1.2') })
  const skills = await prepareAgentSkills(options)
  assert.equal(skills[1].name, 'document-organizer')
  assert.match(await readFile(skills[1].path, 'utf8'), /^---\nname: document-organizer\n/u,
    'native discovery reads SKILL.md metadata, not the name of the symlink')
  state.inner = true
  await assert.rejects(prepareAgentSkills(options), /EXECUTION_SKILL_BUILTIN_MISSING/u)
})

test('a failed version update download rejects instead of executing the old cached version', async t => {
  const { options, state } = await fixture(t)
  const before = await prepareAgentSkills(options)
  state.version = '2'
  state.downloadStatus = 403
  await assert.rejects(prepareAgentSkills(options), /download failed/u)
  assert.equal(state.downloads, 2)
  assert.match(await readFile(before[1].path, 'utf8'), /test body/u, 'old cache remains intact but is not returned')
})

test('the exact Docker COPY subset imports without the DSH workspace or type-only source files', async t => {
  const { root } = await fixture(t)
  const image = join(root, 'image')
  for (const subdir of ['scripts', 'src']) await mkdir(join(image, subdir), { recursive: true })
  for (const source of ['scripts/prepare-agent-skills.mjs', 'src/skill-sync.ts', 'src/generation-paths.ts']) {
    await copyFile(resolve(import.meta.dirname, '..', source), join(image, source))
  }
  await symlink(resolve(import.meta.dirname, '../node_modules'), join(image, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  const url = pathToFileURL(join(image, 'scripts', 'prepare-agent-skills.mjs')).href
  const output = execFileSync(process.execPath, ['--experimental-transform-types', '--input-type=module', '-e',
    `const m=await import(${JSON.stringify(url)});console.log(typeof m.prepareAgentSkills)`], { encoding: 'utf8' })
  assert.equal(output.trim(), 'function')
})

test('the repository builtin payload parses through the tool preparation entrypoint', async t => {
  const { options, state } = await fixture(t)
  state.bindings[1001] = []
  const skills = await prepareAgentSkills({ ...options,
    environment: { ...options.environment, BYCLAW_SKILLS_DIR: resolve(import.meta.dirname, '../../../../builtin/skills') } })
  assert.ok(skills.length > 20)
  assert.ok(skills.some(skill => skill.name === 'by-knowledge-manager'))
  assert.ok(skills.some(skill => skill.name === 'skill-creator'))
})
