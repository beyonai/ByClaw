import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { prepare, prepareSource, nameBefore, gestureBefore } from './prepare-dsh-skill-names-021.mjs'

test('Unicode names and gestures keep path, markup and whitespace boundaries', () => {
  const matcher = new Function(prepareSource(nameBefore, 'skill') + ';return SKILL_NAME')()
  const gesture = new Function(prepareSource(gestureBefore, 'tool-skill') + ';return SKILL_GESTURE')()
  for (const name of ['report', 'my-report', 'report_企业', '数据分析_企业', 'report_User001_企业']) {
    assert.equal(matcher.test(name), true, name)
    assert.deepEqual([...`Use /${name} please`.matchAll(gesture)].map(m => m[2]), [name])
  }
  for (const name of ['../report', 'report/企业', 'report\\企业', 'report\n企业', 'report(企业)',
    'report 企业', '<report>', 'report"', '-report', 'report_', 'report__企业', 'report\0企业']) {
    assert.equal(matcher.test(name), false, name)
  }
  for (const text of ['/usr/bin', '5/8', '/report_企业/path', '//report_企业', '/report_企业.txt']) {
    assert.deepEqual([...text.matchAll(gesture)], [], text)
  }
})

test('patch validates version, both sources and workspace boundaries before writing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'byclaw-skill-names-'))
  const outside = await mkdtemp(join(tmpdir(), 'byclaw-skill-names-outside-'))
  try {
    const inputs = [['skill', nameBefore], ['tool-skill', gestureBefore]]
    for (const [kind, source] of inputs) {
      const dir = join(root, 'packages/skill', kind)
      await mkdir(join(dir, 'src'), { recursive: true })
      await writeFile(join(dir, 'package.json'), JSON.stringify({ name: `@deepseek-ai/dsh-${kind}`, version: '0.2.1-rc.2' }))
      await writeFile(join(dir, 'src/index.ts'), source)
      assert.throws(() => prepareSource('upstream changed', kind), /Unsupported/)
      assert.throws(() => prepareSource(source + source, kind), /Unsupported/)
      assert.throws(() => prepareSource(prepareSource(source, kind) + source, kind), /Unsupported/)
    }
    const tool = join(root, 'packages/skill/tool-skill')
    await writeFile(join(tool, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-tool-skill', version: '0.2.2' }))
    await assert.rejects(prepare(root), /Expected/)
    assert.equal(await readFile(join(root, 'packages/skill/skill/src/index.ts'), 'utf8'), nameBefore)
    await writeFile(join(tool, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-tool-skill', version: '0.2.1-rc.2' }))
    await prepare(root); await prepare(root)
    for (const [kind, source] of inputs) {
      assert.equal(await readFile(join(root, 'packages/skill', kind, 'src/index.ts'), 'utf8'), prepareSource(source, kind))
    }
    await writeFile(join(outside, 'index.ts'), gestureBefore)
    await unlink(join(tool, 'src/index.ts'))
    await symlink(join(outside, 'index.ts'), join(tool, 'src/index.ts'))
    await assert.rejects(prepare(root), /escapes/)
    assert.equal(await readFile(join(outside, 'index.ts'), 'utf8'), gestureBefore)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

for (const name of ['Dockerfile', 'Dockerfile.extensions', 'Dockerfile.slim']) {
  test(`${name}: rebuilds, packs, installs and ships both patched Skill packages`, async () => {
    const source = await readFile(new URL('../' + name, import.meta.url), 'utf8')
    assert.match(source, /RUN node scripts\/prepare-dsh-skill-names-021\.mjs \/workspace/)
    assert.match(source, /tsc -b packages\/skill\/skill\/tsconfig.json packages\/skill\/tool-skill\/tsconfig.json/)
    assert.match(source, /tsdown .*--filter packages\/skill\/skill --filter packages\/skill\/tool-skill/)
    assert.match(source, /for skill_package in skill tool-skill; do/)
    assert.ok(source.includes('/workspace/packages/skill/${skill_package}/package.json'))
    assert.match(source, /Profile resolved unpatched Skill names/)
    for (const stage of ['plugin-builder', ...(name === 'Dockerfile.slim' ? ['profile-builder'] : [])]) {
      for (const kind of ['skill', 'tool-skill']) for (const dir of ['src', 'lib']) {
        assert.ok(source.includes(`COPY --from=${stage} --chown=byclaw:byclaw /workspace/packages/skill/${kind}/${dir}/ /workspace/packages/skill/${kind}/${dir}/`))
      }
    }
  })
}
