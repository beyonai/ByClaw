import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const harness = fileURLToPath(new URL('../../../', import.meta.url))
for (const image of ['Dockerfile', 'Dockerfile.slim', 'Dockerfile.extensions']) {
  it(`${image} builds, packs and checks the workspace adapter and pinned recorder`, async () => {
    const source = await readFile(new URL('../../../' + image, import.meta.url), 'utf8')
    expect(source).toContain('COPY middleware/byclaw-harness/plugins/ /workspace/plugins/')
    expect(source).toContain('node scripts/docker-plugin-layout.mjs bundles plugins')
    expect(source).toContain('node scripts/docker-plugin-layout.mjs packages plugins')
    expect(source).toContain('/workspace/packages/deliverables/workspace-changes/package.json')
    expect(source).toContain('test -s /opt/byclaw/plugins/byclaw--dsh-workspace/lib/index.js')
    expect(source).toContain('test -s /opt/byclaw/plugins/byclaw--dsh-workspace/cordis.patch.yml')
    expect(source).toContain('BYCLAW_DSH_WORKSPACE_CHANGES_ENABLED=0')
    expect(source).toContain('BYCLAW_DSH_WORKSPACE_GIT_ENABLED=0')
  })
}

it('the normal Docker plugin inventory includes the new bundle and package', () => {
  for (const mode of ['bundles', 'packages']) {
    const result = execFileSync(process.execPath, ['scripts/docker-plugin-layout.mjs', mode, 'plugins'], { cwd: harness, encoding: 'utf8' })
    expect(result.split('\n').some(line => line.endsWith('/plugins/byclaw-workspace/package.json'))).toBe(true)
  }
})
