import assert from 'node:assert/strict'
import dns from 'node:dns/promises'
import tls from 'node:tls'
import test from 'node:test'
import { downloadAsset, resolveDownloadLookup } from '../src/http.js'

function connectLookup(lookup, host, options = {}) {
  return new Promise((resolve, reject) => lookup(host, options, (error, address, family) => error ? reject(error) : resolve(options.all ? address : { address, family })))
}

test('connection lookup pins the public validation result even if DNS later rebinds', async () => {
  let resolutions = 0
  const answers = [{ address: '93.184.216.34', family: 4 }]
  const pinned = await resolveDownloadLookup('assets.example', async () => { resolutions++; return answers })
  answers[0].address = '127.0.0.1'
  assert.deepEqual(await connectLookup(pinned, 'assets.example'), { address: '93.184.216.34', family: 4 })
  assert.deepEqual(await connectLookup(pinned, 'assets.example', { all: true }), [{ address: '93.184.216.34', family: 4 }])
  assert.equal(resolutions, 1)
  await assert.rejects(connectLookup(pinned, 'other.example'), /HOST_MISMATCH/)
})

test('pinned lookup supports IPv6 and family selection without a second resolution', async () => {
  const pinned = await resolveDownloadLookup('assets.example', async () => [
    { address: '2606:4700:4700::1111', family: 6 }, { address: '1.1.1.1', family: 4 },
  ])
  assert.deepEqual(await connectLookup(pinned, 'assets.example', { family: 6 }), { address: '2606:4700:4700::1111', family: 6 })
  assert.deepEqual(await connectLookup(pinned, 'assets.example', { family: 4, all: true }), [{ address: '1.1.1.1', family: 4 }])
})

test('private, reserved, malformed, and mixed DNS answers reject before connection', async () => {
  for (const address of ['0.0.0.0', '10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.1.1', '192.168.1.1', '100.64.0.1', '224.0.0.1', '::', '::1', '0:0:0:0:0:0:0:1', 'fe80::1', 'fc00::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '2002:7f00:1::', 'bad-address']) {
    await assert.rejects(resolveDownloadLookup('assets.example', async () => [{ address, family: address.includes(':') ? 6 : 4 }]), /PRIVATE_DOWNLOAD/)
  }
  await assert.rejects(resolveDownloadLookup('assets.example', async () => [{ address: '1.1.1.1', family: 4 }, { address: '127.0.0.1', family: 4 }]), /PRIVATE_DOWNLOAD/)
  await assert.rejects(resolveDownloadLookup('assets.example', async () => []), /PRIVATE_DOWNLOAD/)
})

test('IP literal downloads reject local forms even with an injected transport', async () => {
  for (const host of ['127.1', '2130706433', '0x7f000001', '[0:0:0:0:0:0:0:1]', '[::ffff:127.0.0.1]', '[ff02::1]', 'localhost.', 'sub.localhost']) {
    await assert.rejects(downloadAsset(`https://${host}/audio`, { fetch: async () => assert.fail('private transport call') }), /PRIVATE_DOWNLOAD/)
  }
})

test('real download path uses a dedicated pinned dispatcher and destroys it after reading', async (t) => {
  let dispatcher
  let calls = 0
  t.mock.method(dns, 'lookup', async () => { calls++; return [{ address: '93.184.216.34', family: 4 }] })
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://assets.example/audio?signature=test')
    assert.equal(init.redirect, 'error')
    assert.equal(init.headers, undefined)
    dispatcher = init.dispatcher
    assert.ok(dispatcher, 'validated DNS must be supplied to the connection dispatcher')
    assert.equal(dispatcher.destroyed, false)
    return new Response('audio', { headers: { 'content-type': 'audio/mpeg' } })
  })
  const result = await downloadAsset('https://assets.example/audio?signature=test')
  assert.equal(result.bytes.toString(), 'audio')
  assert.equal(calls, 1)
  assert.equal(dispatcher.destroyed, true)
})

test('dispatcher is destroyed when download transport fails', async (t) => {
  let dispatcher
  t.mock.method(dns, 'lookup', async () => [{ address: '1.1.1.1', family: 4 }])
  t.mock.method(globalThis, 'fetch', async (_url, init) => { dispatcher = init.dispatcher; throw new Error('signed-url-secret') })
  await assert.rejects(downloadAsset('https://assets.example/audio'), (error) => error.message === 'MEDIA_TRANSPORT_FAILED')
  assert.equal(dispatcher.destroyed, true)
})

test('Undici TLS connection uses validated lookup while retaining hostname and SNI', async (t) => {
  let resolutions = 0
  let connectOptions
  t.mock.method(dns, 'lookup', async () => {
    resolutions++
    return [{ address: resolutions === 1 ? '93.184.216.34' : '127.0.0.1', family: 4 }]
  })
  // Intercept at the socket boundary: actual Undici dispatch runs, but no socket
  // opens and no live provider is contacted.
  t.mock.method(tls, 'connect', (options) => {
    connectOptions = options
    throw new Error('intentional test socket stop')
  })
  await assert.rejects(downloadAsset('https://assets.example/audio'), /MEDIA_TRANSPORT_FAILED/)
  assert.equal(connectOptions.host, 'assets.example')
  assert.equal(connectOptions.servername, 'assets.example')
  assert.equal(typeof connectOptions.lookup, 'function')
  assert.deepEqual(await connectLookup(connectOptions.lookup, 'assets.example', { all: true }), [{ address: '93.184.216.34', family: 4 }])
  assert.equal(resolutions, 1)
})

test('injected test transports retain deterministic no-DNS behavior', async (t) => {
  t.mock.method(dns, 'lookup', async () => assert.fail('unexpected DNS'))
  const asset = await downloadAsset('https://assets.example/audio', { fetch: async (_url, init) => {
    assert.equal(init.dispatcher, undefined)
    return new Response('audio')
  } })
  assert.equal(asset.bytes.toString(), 'audio')
})
