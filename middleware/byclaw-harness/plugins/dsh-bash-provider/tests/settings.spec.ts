import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ByClawSettingsProvider from '../src/settings.ts'

const contexts: Context[] = []
const directories: string[] = []
const conversationSchema = z.object({ busyEnter: z.union(['queue', 'steer']).default('queue') })

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

async function setup(value: string | undefined, document?: string) {
  vi.stubEnv('BYCLAW_DSH_BUSY_ENTER', value)
  const directory = await mkdtemp(join(tmpdir(), 'byclaw-busy-enter-'))
  directories.push(directory)
  const filename = join(directory, 'settings.yaml')
  if (document !== undefined) await writeFile(filename, document)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(ByClawSettingsProvider, { path: filename, watch: false })
  const scope = ctx.settings.register('ui-conversation', conversationSchema)
  return { ctx, scope, filename }
}

describe('busy Enter environment default', () => {
  it.each([
    [undefined, 'queue'],
    ['queue', 'queue'],
    ['steer', 'steer'],
  ])('resolves %s as %s without writing a settings file', async (value, expected) => {
    const { ctx, scope, filename } = await setup(value)
    expect(scope.get()).toEqual({ busyEnter: expected })
    expect(ctx.settings.describe()[0]).toMatchObject({ base: { busyEnter: expected } })
    await expect(readFile(filename)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([
    ['steer', 'queue'],
    ['queue', 'steer'],
  ])('preserves a saved %s preference over the %s environment default', async (saved, value) => {
    const document = `# keep this comment\nui-conversation:\n  busyEnter: ${saved}\nother:\n  enabled: true\n`
    const { scope, filename } = await setup(value, document)
    expect(scope.get()).toEqual({ busyEnter: saved })
    expect(await readFile(filename, 'utf8')).toBe(document)
    await scope.replace({})
    expect(scope.get()).toEqual({ busyEnter: value })
  })

  it('allows live preference changes and leaves other namespaces unchanged', async () => {
    const { ctx, scope } = await setup('steer')
    await scope.update({ busyEnter: 'queue' })
    expect(scope.get()).toEqual({ busyEnter: 'queue' })
    const other = ctx.settings.register('other', conversationSchema, { base: { busyEnter: 'queue' } })
    expect(other.get()).toEqual({ busyEnter: 'queue' })
  })

  it.each(['', 'invalid', 'STEER'])('rejects unsupported environment value %j', async (value) => {
    await expect(setup(value).then(() => undefined)).rejects.toThrow('BYCLAW_DSH_BUSY_ENTER must be queue or steer')
  })
})
