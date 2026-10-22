import assert from 'node:assert/strict'
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { prepareSource as composition } from './prepare-dsh-client-modules.mjs'
import * as maps from './prepare-dsh-client-maps.mjs'
import * as typert from './prepare-dsh-typert-loader.mjs'
const root = process.env.DSH_ROOT ?? '/workspace'
for (const [name, module, directory, packageName, transform] of [
  ['maps', maps, 'packages/client/modules', '@deepseek-ai/dsh-client-modules', composition],
  ['typert', typert, 'packages/typert/loader', '@deepseek-ai/dsh-typert-loader', value => value],
]) {
  test(`${name}: pinned patch, idempotence, changed source and version rejection`, async () => {
    const source = transform(await readFile(join(root, directory, 'src/index.ts'), 'utf8'))
    const patched = module.prepareSource(source)
    assert.equal(module.prepareSource(patched), patched)
    assert.throws(() => module.prepareSource('unsupported'), /Unsupported/)
    const temp = await mkdtemp(join(tmpdir(), 'byclaw-startup-patch-'))
    try {
      const dir = join(temp, directory); await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'src/index.ts'), source)
      await writeFile(join(dir, 'package.json'), JSON.stringify({ name: packageName, version: '0.1.5-rc.2' }))
      await module.prepare(temp); await module.prepare(temp)
      assert.equal(await readFile(join(dir, 'src/index.ts'), 'utf8'), patched)
      await writeFile(join(dir, 'package.json'), JSON.stringify({ name: packageName, version: '0.1.6' }))
      await assert.rejects(module.prepare(temp), /Expected/)
    } finally { await rm(temp, { recursive: true, force: true }) }
  })
}
