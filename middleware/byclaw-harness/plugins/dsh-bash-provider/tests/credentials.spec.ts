import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { Context } from '@deepseek-ai/cordis'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { createLaunchEnvironmentSnapshot, DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as Search from '@deepseek-ai/dsh-web-search-deepseek'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const redis = vi.hoisted(() => ({ params: {} as Record<string, string>, failing: false }))
vi.mock('@byclaw/by-framework', () => ({
  createRedis: () => ({
    async get(key: string) {
      if (redis.failing) throw new Error('Redis unavailable')
      if (key === 'byai:user:private_params:tester') return JSON.stringify({ params: redis.params })
      return null
    },
    async hgetall() { return {} },
    on() {},
    disconnect() {},
  }),
}))

const require = createRequire(import.meta.url)
const cleanups: Array<() => Promise<unknown>> = []
const key = credentialRef('DEEPSEEK_API_KEY')
beforeEach(() => {
  redis.params = { DEEPSEEK_API_KEY: 'redis-first' }
  redis.failing = false
  vi.stubEnv('USER_CODE', 'tester')
})
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

async function setup(config: Search.Config = {}, inherited: Record<string, string> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'byclaw-credentials-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  ctx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([{ source: 'process', values: inherited }]))
  const rows = composeEntries([
    loadOverlayPatches('credentials-test', require.resolve('@deepseek-ai/dsh-base/cordis.patch.yml')),
    loadOverlayPatches('credentials-test', join(import.meta.dirname, '../cordis.patch.yml')),
  ])
  const row = rows.find(row => row.id === 'byclaw-credentials')
  const provider = row === undefined ? LocalCredentialProvider : (await import('../src/credentials.ts')).default
  const filename = join(dir, 'credentials.yaml')
  await ctx.plugin(provider, { path: filename, watch: false })
  await ctx.plugin(WebRuntime)
  await ctx.plugin(Search, { baseURL: 'https://search.test', ...config })
  const sent: string[] = []
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    sent.push(new Headers(init.headers).get('x-api-key')!)
    return Response.json({ content: [{ type: 'web_search_tool_result', content: [
      { type: 'web_search_result', url: 'https://result.test', title: 'Result' },
    ] }] })
  })
  return { ctx, sent, filename }
}

it('searches with Redis credentials without first running Bash, and observes rotation', async () => {
  const { ctx, sent } = await setup()
  expect((await ctx.web.search({ query: 'first' })).sources[0]?.url).toBe('https://result.test')
  redis.params['DEEPSEEK_API_KEY'] = 'redis-second'
  await ctx.web.search({ query: 'second' })
  expect(sent).toEqual(['redis-first', 'redis-second'])
})

it('shares Redis credentials with host plugins but descriptions contain only state and source', async () => {
  const { ctx, sent } = await setup({}, { DEEPSEEK_API_KEY: 'inherited' })
  await ctx.web.search({ query: 'private key' })
  expect(sent).toEqual(['redis-first'])
  expect(await ctx.credentials.resolve(key)).toEqual({ value: 'redis-first', source: 'redis' })
  expect(await ctx.credentials.describe(key)).toEqual({ configured: true, source: 'redis', writable: false })
})

it('keeps the last good Redis value on outage, and falls back after the key is removed', async () => {
  const { ctx, sent } = await setup()
  await ctx.web.search({ query: 'first' })
  redis.failing = true
  await ctx.web.search({ query: 'outage' })
  redis.failing = false
  redis.params = {}
  await ctx.credentials.set(key, 'stored')
  await ctx.web.search({ query: 'removed' })
  expect(sent).toEqual(['redis-first', 'redis-first', 'stored'])
})

it('uses the original credential source when Redis is unavailable from startup', async () => {
  redis.failing = true
  const { ctx, sent } = await setup({}, { DEEPSEEK_API_KEY: 'inherited' })
  await ctx.web.search({ query: 'fallback' })
  expect(sent).toEqual(['inherited'])
})

it('preserves explicit search apiKey precedence and supports custom credential references', async () => {
  const literal = await setup({ apiKey: 'literal' })
  await literal.ctx.web.search({ query: 'literal' })
  expect(literal.sent).toEqual(['literal'])
  redis.params = { CUSTOM_SEARCH_KEY: 'custom' }
  const custom = await setup({ apiKeyEnv: 'CUSTOM_SEARCH_KEY' })
  await custom.ctx.web.search({ query: 'custom' })
  expect(custom.sent).toEqual(['custom'])
})

it('resolves other Redis references for plugins without writing files or changing process.env', async () => {
  redis.params = { DEEPSEEK_API_KEY: 'search-only', BEYOND_TOKEN: 'shared-token' }
  const before = { ...process.env }
  const { ctx, filename } = await setup()
  const other = credentialRef('BEYOND_TOKEN')
  const result = await ctx.web.search({ query: 'shared credentials' })
  expect(await ctx.credentials.resolve(other)).toEqual({ value: 'shared-token', source: 'redis' })
  expect(await ctx.credentials.describe(other)).toEqual({ configured: true, source: 'redis', writable: false })
  expect(JSON.stringify(result)).not.toContain('search-only')
  expect(process.env).toEqual(before)
  await expect(readFile(filename)).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(ctx.credentials.set(other, 'ineffective')).rejects.toThrow(/Redis/)
  await expect(ctx.credentials.unset(other)).rejects.toThrow(/Redis/)
})
