/** Projection must preserve foreign files without copying revoked managed templates. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectByClawResourcesToTemplates } from '../lib/integration.js'
import { writeAgentTemplate } from '../lib/agent-template.js'
import { writeTeamTemplate } from '@byclaw/dsh-agent-teams/catalog'
const root = fs.mkdtempSync(join(tmpdir(), 'byclaw-staging-'))
const agents = join(root, 'agents'), teams = join(root, 'teams'), cache = join(root, 'skills')
const agentFiles = join(agents, 'templates'), teamFiles = join(teams, 'templates')
const resources = { employees: [], groups: [], directEmployeeIds: [], authHeaders: {}, watchedResourceIds: [] }
const template = id => ({ schemaVersion: 'dsh.agent-template/v1', id, kind: 'agent', name: id,
  description: '', persona: 'fixture '.repeat(8192), skills: [], source: { system: 'byclaw',
    resourceId: id, resourceCode: id, workerAgentType: 'test', directlyAuthorized: true } })
const copied = []
const originalCp = fs.promises.cp
try {
  for (let index = 0; index < 60; index++) await writeAgentTemplate(agents, template(`byclaw-employee-${index}`))
  for (let index = 0; index < 6; index++) await writeTeamTemplate(teams, { id: `byclaw-team-${index}`, name: 'fixture', members: [] })
  const foreign = { ...template('custom-agent'), source: { system: 'custom' } }
  await writeAgentTemplate(agents, foreign)
  await writeTeamTemplate(teams, { id: 'custom-team', name: 'user team', members: [] })
  fs.writeFileSync(join(teamFiles, 'invalid.json'), 'not JSON')
  fs.mkdirSync(join(agentFiles, 'notes'))
  fs.writeFileSync(join(agentFiles, 'notes/user.txt'), 'user file')
  fs.symlinkSync(join(agentFiles, 'notes/user.txt'), join(agentFiles, 'note-link'))
  const foreignBytes = fs.readFileSync(join(agentFiles, 'custom-agent.json'))
  fs.promises.cp = async (source, ...args) => { copied.push(String(source)); return originalCp(source, ...args) }
  syncBuiltinESMExports()
  const phases = {}
  await projectByClawResourcesToTemplates({ resources, agentTemplateDir: agents, teamCatalogDir: teams,
    cacheRoot: cache, baseUrl: 'http://unused.test', deferSkillSync: true,
    onPhase: (name, ms) => { phases[name] = ms } })
  assert.deepEqual(fs.readFileSync(join(agentFiles, 'custom-agent.json')), foreignBytes)
  assert.equal(fs.readFileSync(join(agentFiles, 'notes/user.txt'), 'utf8'), 'user file')
  assert.ok(fs.lstatSync(join(agentFiles, 'note-link')).isSymbolicLink())
  assert.equal(fs.readFileSync(join(teamFiles, 'invalid.json'), 'utf8'), 'not JSON')
  assert.ok(fs.existsSync(join(teamFiles, 'custom-team.json')))
  assert.equal(fs.readdirSync(agentFiles).filter(name => name.startsWith('byclaw-')).length, 0)
  assert.equal(fs.readdirSync(teamFiles).filter(name => name.startsWith('byclaw-')).length, 0)
  console.log(JSON.stringify({ phases, copiedEntries: copied.length, copiedCatalogRoots: copied.filter(path => [agentFiles, teamFiles].includes(path)).length }))
  assert.ok(!copied.some(path => [agentFiles, teamFiles].includes(path) || /byclaw-(employee|team)-\d+\.json$/.test(path)), 'staging must not copy the complete catalog or revoked managed templates')
  // Existing validation failures must leave the published generation untouched.
  fs.writeFileSync(join(agentFiles, 'corrupt.json'), '{bad')
  await assert.rejects(projectByClawResourcesToTemplates({ resources, agentTemplateDir: agents,
    teamCatalogDir: teams, cacheRoot: cache, baseUrl: 'http://unused.test', deferSkillSync: true }))
  assert.deepEqual(fs.readFileSync(join(agentFiles, 'custom-agent.json')), foreignBytes)
  assert.equal(fs.readFileSync(join(agentFiles, 'corrupt.json'), 'utf8'), '{bad')
  fs.unlinkSync(join(agentFiles, 'corrupt.json'))
  await writeAgentTemplate(agents, template('misdirected'))
  const path = join(agentFiles, 'misdirected.json')
  const record = JSON.parse(fs.readFileSync(path, 'utf8')); record.id = 'owned-directory'
  fs.writeFileSync(path, JSON.stringify(record))
  fs.mkdirSync(join(agentFiles, 'owned-directory.json'))
  fs.writeFileSync(join(agentFiles, 'owned-directory.json/keep.txt'), 'must survive')
  await assert.rejects(projectByClawResourcesToTemplates({ resources, agentTemplateDir: agents,
    teamCatalogDir: teams, cacheRoot: cache, baseUrl: 'http://unused.test', deferSkillSync: true }))
  assert.equal(fs.readFileSync(join(agentFiles, 'owned-directory.json/keep.txt'), 'utf8'), 'must survive')
  console.log('template staging: foreign files, revocation, no redundant copies and failure preservation passed')
} finally {
  fs.promises.cp = originalCp; syncBuiltinESMExports()
  fs.rmSync(root, { recursive: true, force: true })
}
