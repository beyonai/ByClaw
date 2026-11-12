import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const base = new URL('../', import.meta.url)

test('Unity manifest declares Unity and inherited execution capabilities over private SSH', async () => {
  const manifest = JSON.parse(await readFile(new URL('tool-sandbox/unity.capabilities.json', base)))
  assert.equal(manifest.contract, 'byclaw.tool-sandbox/v1')
  assert.equal(manifest.purpose, 'unity')
  assert.equal(manifest.runtimeVersion, 'D0.6.0_unity')
  assert.deepEqual(manifest.capabilities, ['process.exec', 'filesystem', 'browser.automation', 'game.unity'])
  assert.deepEqual(manifest.operations, { protocol: 'ssh', exposure: 'private' })
})

test('Unity layer requires controlled installation assets and keeps user state out of the image', async () => {
  const dockerfile = await readFile(new URL('Dockerfile.tools.unity', base), 'utf8')
  assert.match(dockerfile, /^ARG UNITY_DONOR_IMAGE\s*$/m)
  assert.match(dockerfile, /^FROM \$\{UNITY_DONOR_IMAGE\} AS unity-assets$/m)
  assert.match(dockerfile, /ARG BROWSER_IMAGE=192\.168\.0\.81:8080\/byclaw\/byclaw-harness:D0\.6\.0_browser/)
  const donorCopies = dockerfile.split('\n').filter((line) => line.startsWith('COPY --from=unity-assets '))
  assert.ok(donorCopies.length > 0)
  for (const line of donorCopies) {
    assert.match(line, /^COPY --from=unity-assets (?:\/opt\/unity(?:\/|hub\/)|\/usr\/local\/bin\/unity-)/)
    assert.doesNotMatch(line, /\/(?:home|root|by|workspace|etc)(?:\/|\s)/)
  }
  assert.doesNotMatch(dockerfile, /UNITY_WEBGL_URL|curl .*unity|wget .*unity/)
})

test('Unity validates installed WebGL tools and isolates desktop startup credentials', async () => {
  const dockerfile = await readFile(new URL('Dockerfile.tools.unity', base), 'utf8')
  assert.match(dockerfile, /WebGLSupport\/BuildTools\/Emscripten\/llvm\/clang/)
  assert.match(dockerfile, /WebGLSupport\/BuildTools\/Emscripten\/binaryen\/bin\/wasm-opt/)
  assert.match(dockerfile, /ldd "\$binary"/)
  assert.match(dockerfile, /if grep -q 'not found'/)
  assert.match(dockerfile, /env -u BYCLAW_TOOL_ENV_HOST_KEY -u BYCLAW_TOOL_ENV_AUTHORIZED_KEY su/)
  assert.match(dockerfile, /UPM_REGISTRY=https:\/\/packages\.unity\.cn/)
  assert.match(dockerfile, /6901/)
  assert.match(dockerfile, /install -y --no-install-recommends libicu76/)
  assert.match(dockerfile, /ENTRYPOINT \["\/usr\/local\/bin\/unity-entrypoint"\]/)
})
