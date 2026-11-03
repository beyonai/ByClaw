import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

for (const name of ['Dockerfile', 'Dockerfile.extensions']) {
  test(`${name} starts local VNC eagerly for declared-port readiness`, async () => {
    const source = await readFile(new URL(`../${name}`, import.meta.url), 'utf8')
    assert.equal(/BYCLAW_BROWSER_STARTUP=eager(?:\s|\\)/.test(source), true, 'declared VNC ports must listen before readiness')
  })
}

test('the separate slim tool image keeps its existing on-demand default', async () => {
  const source = await readFile(new URL('../Dockerfile.tool_slim', import.meta.url), 'utf8')
  assert.match(source, /BYCLAW_BROWSER_STARTUP=on-demand(?:\s|\\)/)
})
