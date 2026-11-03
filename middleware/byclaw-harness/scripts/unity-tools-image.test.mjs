import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
const base = new URL('../', import.meta.url)
test('Unity manifest satisfies the existing unity/games SSH admission contract', async () => {
  const manifest = JSON.parse(await readFile(new URL('tool-sandbox/unity.capabilities.json', base)))
  assert.equal(manifest.contract, 'byclaw.tool-sandbox/v1')
  assert.equal(manifest.purpose, 'unity')
  assert.deepEqual(manifest.capabilities, ['unity', 'games'])
  assert.deepEqual(manifest.operations, { protocol: 'ssh', exposure: 'private' })
})
test('Unity layer pins the CN module and validates installed tools before publishing capability', async () => {
  const dockerfile = await readFile(new URL('Dockerfile.tools.unity', base), 'utf8')
  assert.match(dockerfile, /2022\.3\.62f3c1/)
  assert.match(dockerfile, /7193dfdb816cb244db7604609be9916fdcc6364c777be04246430b7049a9cd8d/)
  assert.match(dockerfile, /sha256sum -c/)
  assert.match(dockerfile, /WebGLSupport/)
  assert.match(dockerfile, /emcc --version/)
  assert.match(dockerfile, /byclaw-tool-env-sshd/)
  assert.doesNotMatch(dockerfile, /^\s*(?:ENTRYPOINT|CMD|WORKDIR|ENV)\s/m)
})
