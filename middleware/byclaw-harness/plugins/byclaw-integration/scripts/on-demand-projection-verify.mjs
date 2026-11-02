/** Exercise lazy discovery against the real atomic projector and filesystem. */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ByClawOnDemandResources } from '../lib/on-demand-resources.js'
import { loadAuthorizedByClawResources } from '../lib/catalog.js'
import { projectByClawResourcesToTemplates } from '../lib/integration.js'
import { ByClawGenerationLease } from '../lib/generation-lease.js'
const root = await mkdtemp(join(tmpdir(), 'byclaw-on-demand-'))
const agents = join(root, 'agents'), teams = join(root, 'teams'), skills = join(root, 'skills')
const lease = new ByClawGenerationLease()
const snapshots = new Map(Array.from({ length: 56 }, (_, index) => {
  const id = String(index + 1)
  return [id, { resourceId: id, resourceCode: `EMP_${id}`, resourceName: `Employee ${id}`, workerAgentType: 'BYCLAW_DSH', configVersion: 'v1' }]
}))
snapshots.set('99', { resourceId: '99', resourceCode: 'GROUP_99', resourceName: 'Group', workerAgentType: 'BY_SUPER', configVersion: 'v1',
  employeeGroupMembers: [{ resourceId: '56', resourceCode: 'EMP_56', name: 'Employee 56', sortOrder: 1 }] })
let grants = [...snapshots.keys()].filter(id => id !== '56')
let models = [], groups = [], views = [], failModel, failGroup
const redis = {
  async get(key) {
    if (key.startsWith('SHARE_BFM_USER_CODE_')) return '42'
    const value = snapshots.get(key.replace('DIG_EMPLOYEE_', ''))
    return value === undefined ? null : JSON.stringify(value)
  },
  async exists() { return 1 },
  async hgetall(key) { return key.startsWith('USER:RESOURCES:AUTH:') ? Object.fromEntries(grants.map(id => [id, 'DIG_EMPLOYEE'])) : { 'Beyond-Token': 'fixture' } },
}
const runtime = new ByClawOnDemandResources({
  load: options => loadAuthorizedByClawResources({ redis, userCode: 'test', baseUrl: 'http://unused.test', ...options }),
  onCatalog() {},
  publish: async (resources, retainTemplateIds, requiredTemplateId) => {
    const result = await projectByClawResourcesToTemplates({ resources, agentTemplateDir: agents, teamCatalogDir: teams,
      cacheRoot: skills, baseUrl: 'http://unused.test', generationLease: lease, retainTemplateIds, requiredTemplateId, deferSkillSync: true,
      async resolveModel(id) { models.push(id); if (id === failModel) throw new Error('model unavailable'); return { provider: 'test', model: 'test' } },
      async resolveGroupRuntime(id) { groups.push(id); if (failGroup) throw new Error('group unavailable'); return { id, name: 'Group', modelId: 'test', configVersion: 'v1', promptVersion: 'v1', contextProfile: 'team',
        members: [{ employeeId: '56', employeeCode: 'EMP_56', name: 'Employee 56', order: 1 }] } },
      async prepareSkillGeneration(templates, _root, retained) {
        views.push({ templates: templates.map(template => template.id), retained: [...retained] })
        return () => {}
      },
    })
    return result.agents.map(template => template.id)
  },
})
try {
  const catalog = await runtime.discover()
  assert.equal(catalog.employees.length, 55)
  assert.equal(catalog.groups.length, 1)
  assert.deepEqual(models, [])
  assert.deepEqual(groups, [])
  await assert.rejects(stat(agents), { code: 'ENOENT' })
  await runtime.prepare('byclaw-employee-1')
  assert.deepEqual(models, ['employee:1'])
  assert.deepEqual(await readdir(join(agents, 'templates')), ['byclaw-employee-1.json'])
  const firstBytes = await readFile(join(agents, 'templates/byclaw-employee-1.json'))
  // Lazy association refresh can add cached content without editing template JSON.
  const lateSkill = join(skills, 'late-associated-skill')
  await mkdir(lateSkill, { recursive: true })
  await writeFile(join(lateSkill, 'SKILL.md'), '---\nname: late-associated-skill\ndescription: Later grant\n---\nStill in use')
  await Promise.all([runtime.prepare('byclaw-employee-2'), runtime.prepare('byclaw-employee-2')])
  assert.deepEqual(models, ['employee:1', 'employee:2'])
  await stat(join(lateSkill, 'SKILL.md'))
  assert.deepEqual(await readFile(join(agents, 'templates/byclaw-employee-1.json')), firstBytes)
  assert.deepEqual(views.at(-1).retained, ['byclaw-employee-1'])
  await runtime.prepare('byclaw-employee-1')
  assert.equal(models.length, 2)
  await runtime.prepare('byclaw-group-99')
  assert.deepEqual(groups, ['99'])
  assert.deepEqual(models, ['employee:1', 'employee:2', 'employee:56'])
  await runtime.prepare('byclaw-employee-3')
  await stat(join(teams, 'templates/byclaw-team-99.json'))
  assert(views.at(-1).retained.includes('byclaw-group-99'))
  await assert.rejects(runtime.prepare('byclaw-employee-56'), /authorized/)
  grants = grants.filter(id => id !== '1')
  await runtime.prepare('byclaw-employee-4')
  await assert.rejects(stat(join(agents, 'templates/byclaw-employee-1.json')), { code: 'ENOENT' })
  await assert.rejects(runtime.prepare('byclaw-employee-1'), /authorized/)
  failModel = 'employee:5'
  await assert.rejects(runtime.prepare('byclaw-employee-5'), /could not be prepared/)
  await stat(join(agents, 'templates/byclaw-employee-2.json'))
  snapshots.set('100', { ...snapshots.get('99'), resourceId: '100', resourceCode: 'GROUP_100',
    employeeGroupMembers: [{ resourceId: '2', name: 'Employee 2', sortOrder: 1 }] })
  grants.push('100')
  failGroup = true
  const beforeFailure = await readFile(join(agents, 'templates/byclaw-employee-2.json'))
  await assert.rejects(runtime.prepare('byclaw-group-100'), /could not be prepared/)
  assert.deepEqual(await readFile(join(agents, 'templates/byclaw-employee-2.json')), beforeFailure,
    'failed group preparation must preserve its already-prepared directly authorized member')
  console.log('real projection: 56 authorized resources; startup 0 model/group/template preparations; first employee 1; cached reuse 0; dependency retention and revocation passed')
} finally { await runtime.close(); await lease.close(); await rm(root, { recursive: true, force: true }) }
