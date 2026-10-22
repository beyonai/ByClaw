/** Read the explicitly mounted local configuration and copy startup inputs to
 * a disposable Redis. Never registers a Worker against the source Redis. */
process.loadEnvFile('/run/byclaw-test.env')
const { createRequire } = await import('node:module')
const requirePlugin = createRequire('/workspace/plugins/byclaw-integration/package.json')
const { createRedis } = requirePlugin('@byclaw/by-framework')
const { loadAuthorizedByClawResources } = await import('/workspace/plugins/byclaw-integration/lib/catalog.js')
const source = createRedis()
delete process.env.REDIS_USERNAME
delete process.env.REDIS_PASSWORD
process.env.REDIS_DATABASE = '0'
const target = createRedis({ mode: 'standalone', host: 'byclaw-startup-redis', port: 6379, db: 0 })
try {
  const userCode = process.env.USER_CODE
  const resources = await loadAuthorizedByClawResources({ redis: source, userCode, baseUrl: process.env.BYCLAW_DSH_BASE_URL })
  await target.set(`SHARE_BFM_USER_CODE_${userCode}`, resources.authorization.userId)
  const hashes = [resources.authorization.authKey, `user:${resources.authorization.userId}:login:auth`,
    'byai:aimodel:config', 'byai:aimodel:typelist']
  for (const key of hashes) {
    const value = await source.hgetall(key)
    if (Object.keys(value).length) await target.hset(key, value)
  }
  for (const id of resources.watchedResourceIds) {
    const key = `DIG_EMPLOYEE_${id}`
    const value = await source.get(key)
    if (value !== null) await target.set(key, value)
  }
  console.log(JSON.stringify({ seeded: true, employees: resources.employees.length, groups: resources.groups.length,
    skillAssociations: resources.employees.reduce((count, item) => count + item.skills.length, 0) }))
} finally { await Promise.all([source.quit(), target.quit()]) }
