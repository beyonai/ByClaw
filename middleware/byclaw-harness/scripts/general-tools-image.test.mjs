import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('general tool image publishes the exact market handshake without claiming a game engine', async () => {
  const manifest = JSON.parse(await read('../tool-sandbox/general.capabilities.json'))
  assert.equal(manifest.contract, 'byclaw.tool-sandbox/v1')
  assert.equal(manifest.purpose, 'general')
  assert.deepEqual(manifest.operations, { protocol: 'ssh', exposure: 'private' })
  assert.deepEqual(manifest.capabilities, ['process.exec', 'filesystem', 'browser.automation'])
  assert.equal(manifest.display.available, true)
  const dockerfile = await read('../Dockerfile.tools')
  assert.match(dockerfile, /COPY middleware\/byclaw-harness\/tool-sandbox\/general\.capabilities\.json \/etc\/byclaw-tool-sandbox\/capabilities\.json/)
  assert.match(dockerfile, /test -f \/opt\/byclaw\/bycli-extension\/manifest\.json/)
  assert.ok(dockerfile.includes("grep -q '^BYCLAW_BROWSER_EXTENSIONS=/opt/byclaw/bycli-extension$'"))
  assert.match(await read('../Dockerfile.tools.dockerignore'), /!middleware\/byclaw-harness\/tool-sandbox\/general\.capabilities\.json/)
})
