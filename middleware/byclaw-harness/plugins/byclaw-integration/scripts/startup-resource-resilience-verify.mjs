/** Resource synchronization failures must not abort plugin cold start. */

import assert from 'node:assert/strict'
import * as plugin from '../src/index.ts'

assert.equal(
  typeof plugin.synchronizeByClawResourcesAtStartup,
  'function',
  'the plugin must expose its cold-start resource failure boundary',
)
assert.equal(
  typeof plugin.logByClawResourceInventory,
  'function',
  'the plugin must expose its resource inventory logger',
)
assert.equal(
  typeof plugin.sanitizeByClawOperationalLog,
  'function',
  'the plugin must expose its operational log sanitizer',
)
const sanitized = plugin.sanitizeByClawOperationalLog(
  'download ftp://user:secret@host/private(foo)?token=abc failed; Authorization: Bearer top-secret; Beyond-Token=another-secret; '
  + 'Sso-Token=sso-secret; WHALE_AGENT_AUTHORIZATION=whale-secret; {"Authorization":"Bearer json-secret"}; '
  + 'Authorization: Basic dXNlcjpwYXNz; Authorization: ApiKey api-secret; '
  + 'Proxy-Authorization: Digest username="admin", response="secret-digest"',
)
assert(!sanitized.includes('user:secret')
  && !sanitized.includes('private(foo)')
  && !sanitized.includes('token=abc')
  && !sanitized.includes('top-secret')
  && !sanitized.includes('another-secret')
  && !sanitized.includes('sso-secret')
  && !sanitized.includes('whale-secret')
  && !sanitized.includes('json-secret')
  && !sanitized.includes('dXNlcjpwYXNz')
  && !sanitized.includes('api-secret')
  && !sanitized.includes('secret-digest'), `operational log leaked credentials: ${sanitized}`)

const fallback = {
  employees: [],
  groups: [],
  directEmployeeIds: [],
  watchedResourceIds: [],
  authHeaders: { 'Beyond-Token': 'fallback-token' },
  authorization: {
    userId: '42',
    authKey: 'USER:RESOURCES:AUTH:42',
    resourceIds: ['404'],
  },
}
const errors = []
const fallbackInventoryLogs = []
const resources = await plugin.synchronizeByClawResourcesAtStartup({
  synchronize: async () => { throw new Error('projection unavailable at ftp://user:secret@host/private.zip?token=abc') },
  fallback,
  logger: {
    error: message => errors.push(message),
    info: message => fallbackInventoryLogs.push(message),
  },
})

assert.equal(resources, fallback)
assert.equal(errors.length, 1)
assert.match(errors[0], /cold-start resource synchronization failed/u)
assert.match(errors[0], /projection unavailable/u)
assert(!errors[0].includes('user:secret') && !errors[0].includes('private.zip') && !errors[0].includes('token=abc'),
  `cold-start error leaked a credential-bearing URL: ${errors[0]}`)
assert(fallbackInventoryLogs.some(message => message.includes('reason=cold-start-fallback')),
  'failed cold start did not emit the retained resource inventory')

const inventoryLogs = []
plugin.logByClawResourceInventory({ info: message => inventoryLogs.push(message) }, {
  employees: [
    {
      id: 'employee-direct',
      code: 'DIG_EMPLOYEE_DIRECT',
      name: 'Direct employee',
      description: '',
      capabilities: '',
      persona: '',
      workerAgentType: 'NONE',
      skills: [
        { id: 'skill-ok', code: 'skill-ok', type: 'hub', downloadUrl: 'https://example.test/ok', versionUrl: 'v1' },
        { id: 'skill-bad', code: 'skill-bad', type: 'hub', downloadUrl: 'https://example.test/bad', versionUrl: 'v1' },
      ],
    },
    {
      id: 'employee-member',
      code: 'DIG_EMPLOYEE_MEMBER',
      name: 'Group member',
      description: '',
      capabilities: '',
      persona: '',
      workerAgentType: 'NONE',
      skills: [],
    },
  ],
  groups: [{
    id: 'group-1',
    code: 'EXPERT_GROUP_1',
    name: 'Expert group',
    description: '',
    workerAgentType: 'BY_SUPER',
    members: [{ employeeId: 'employee-member', employeeCode: 'DIG_EMPLOYEE_MEMBER', name: 'Group member', order: 1 }],
  }],
  directEmployeeIds: ['employee-direct'],
  watchedResourceIds: ['employee-direct', 'employee-member', 'group-1', 'missing-resource'],
  authHeaders: {},
  authorization: {
    userId: '42',
    authKey: 'USER:RESOURCES:AUTH:42',
    resourceIds: ['employee-direct', 'group-1', 'missing-resource'],
  },
}, new Set(['skill-bad']), {
  'employee-direct': { provider: 'provider-a', model: 'model-a', resolution: 'explicit' },
  'employee-member': { provider: 'provider-b', model: 'model-b', resolution: 'default' },
})

assert(inventoryLogs.some(message => message.includes('authorized=3; active=2; unavailable=1')), 'resource inventory summary is missing')
assert(inventoryLogs.some(message => message.includes('type=DIG_EMPLOYEE; id=employee-direct') && message.includes('scope=direct')), 'direct employee status is missing')
assert(inventoryLogs.some(message => message.includes('type=DIG_EMPLOYEE; id=employee-member') && message.includes('scope=group-member')), 'group member status is missing')
assert(inventoryLogs.some(message => message.includes('type=MODEL; owner=employee-direct')
  && message.includes('requested=default')
  && message.includes('provider=provider-a')
  && message.includes('model=model-a')
  && message.includes('resolution=explicit')
  && message.includes('status=ready')), 'direct employee model status is missing')
assert(inventoryLogs.some(message => message.includes('type=EXPERT_GROUP; id=group-1')), 'expert group status is missing')
assert(inventoryLogs.some(message => message.includes('type=SKILL; owner=employee-direct; code=skill-ok; status=ready')), 'healthy associated Skill status is missing')
assert(inventoryLogs.some(message => message.includes('type=SKILL; owner=employee-direct; code=skill-bad; status=skipped')), 'failed associated Skill status is missing')
assert(inventoryLogs.some(message => message.includes('Resource unavailable: id=missing-resource')), 'unavailable authorized resource is missing')

const missingModelLogs = []
plugin.logByClawResourceInventory({ info: message => missingModelLogs.push(message) }, {
  ...fallback,
  employees: [{
    id: 'retained', code: 'RETAINED', name: 'Retained employee', description: '', capabilities: '', persona: '',
    workerAgentType: 'NONE', skills: [],
  }],
  directEmployeeIds: ['retained'],
  authorization: { ...fallback.authorization, resourceIds: ['retained'] },
})
assert(missingModelLogs.some(message => message.includes('type=MODEL; owner=retained') && message.includes('status=unavailable'))
  && missingModelLogs.every(message => !message.includes('status=unresolved')),
  `missing model selection used an unsupported status: ${JSON.stringify(missingModelLogs)}`)

console.log('ByClaw cold-start resource resilience checks passed')
