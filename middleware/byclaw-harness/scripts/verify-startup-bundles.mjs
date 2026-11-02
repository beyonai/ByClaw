/** Verify shipped telemetry bundles against a loopback collector; no external credentials. */
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { createServer } from 'node:http'
import { gunzipSync } from 'node:zlib'
const root = resolve(process.argv[2] ?? '/workspace')
const load = file => import(pathToFileURL(resolve(root, file)).href)
const hook = registerHooks({ load(url, context, next) {
  if (/\/node_modules\/@opentelemetry\/(?:sdk-|core\/|resources\/|otlp-|exporter-)/.test(url)) {
    throw new Error(`Unbundled telemetry implementation: ${url}`)
  }
  if (/\/node_modules\/(?:execa|@deepseek-ai\/libreoffice-kit|fontkit|brotli)\//.test(url)) throw new Error(`Eager optional operation: ${url}`)
  if (/\/node_modules\/undici\//.test(url)) throw new Error(`Eager media transport: ${url}`)
  return next(url, context)
} })
let OTel, ProductTelemetry, Langfuse, Context, readProfileRegistry
try {
  ;({ default: OTel } = await load('packages/telemetry/otel/lib/index.js'))
  ;({ default: ProductTelemetry } = await load('packages/host/product-telemetry-otel/lib/index.js'))
  Langfuse = await load('plugins/dsh-langfuse/lib/index.js')
  ;({ Context } = await load('vendor/cordis/lib/index.js'))
  await load('plugins/byclaw-media-runtime/src/http.js')
  await load('packages/document/office-to-pdf/lib/index.js')
  await load('packages/boot/plugin-manager/lib/index.js')
  ;({ readProfileRegistry } = await load('packages/boot/plugin-manager/lib/types/operations.js'))
} finally { hook.deregister() }
// First real package operation still launches a child and returns its result.
assert.equal(await readProfileRegistry(root, { command: process.execPath, args: ['-e', 'console.log("https://registry.example.test")', '--'], timeoutMs: 5000 }), 'https://registry.example.test')
const captures = []
const server = createServer((req, res) => {
  const chunks = []
  req.on('data', chunk => chunks.push(chunk))
  req.on('end', () => {
    let body = Buffer.concat(chunks)
    if (req.headers['content-encoding'] === 'gzip') body = gunzipSync(body)
    captures.push({ path: req.url, headers: req.headers, body })
    res.end('{}')
  })
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const ctx = new Context()
let service, exporter
try {
  service = await ctx.plugin(OTel)
  for (const compression of ['none', 'gzip']) {
    const fiber = await ctx.plugin(ProductTelemetry, {
      endpoint: `${base}/logs`, compression, serviceName: 'startup-test', serviceVersion: '1',
      channel: 'startup-test', scheduledDelayMillis: 60000,
    })
    try { ctx.productTelemetry.emit({ eventName: 'startup-test', body: 'compiled delivery', timestamp: Date.now() }) }
    finally { await fiber.dispose() }
  }
  assert.equal(captures.length, 2)
  for (const capture of captures) {
    assert.equal(capture.headers['x-channel'], 'startup-test')
    assert.match(capture.body.toString(), /compiled delivery/)
    assert.ok(JSON.parse(capture.body).resourceLogs.length)
  }
  assert.equal(captures[1].headers['content-encoding'], 'gzip')
  const config = Langfuse.resolveConfig({ baseUrl: base, publicKey: 'test-public', secretKey: 'test-secret', otlpEndpoint: `${base}/traces` }, {})
  exporter = new Langfuse.OtelExporter(config)
  const parent = { traceId: '1'.repeat(32), spanId: '2'.repeat(16), traceFlags: 1, isRemote: true }
  const span = exporter.start('compiled-trace', { 'startup.test': true }, parent)
  assert.equal(span.spanContext().traceId, parent.traceId)
  span.end()
  await exporter.close(); exporter = undefined
  const trace = captures.find(c => c.path === '/traces/v1/traces')
  assert.ok(trace?.body.length > 0, 'real protobuf trace reaches the loopback collector')
  assert.match(trace.headers['content-type'], /protobuf/)
  console.log('Compiled telemetry verified: shared Cordis/API, JSON, gzip, parent trace, protobuf export and shutdown; media transport stays lazy')
} finally {
  await exporter?.close()
  await service?.dispose()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
