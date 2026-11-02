// Diagnostic preload for isolated benchmarks only. Counts selected synchronous
// JS filesystem calls before integration activation, not actual NFS RPCs.
// Optional per-call delay models path latency; it is not an ACS measurement.
const fs = require('node:fs')
const { syncBuiltinESMExports } = require('node:module')
const { performance } = require('node:perf_hooks')
const delay = Number(process.env.PROFILE_NAS_DELAY_MS || 0)
if (!Number.isFinite(delay) || delay < 0 || delay > 20) {
  throw new Error('PROFILE_NAS_DELAY_MS must be between 0 and 20')
}
const home = (process.env.DSH_HOME || '/home/byclaw/.dsh').replace(/\/$/, '')
const sleeper = new Int32Array(new SharedArrayBuffer(4))
const start = performance.now()
const counts = {}, stacks = {}
let active = true
for (const name of ['readFileSync', 'realpathSync', 'lstatSync', 'statSync', 'readlinkSync',
  'mkdirSync', 'readdirSync', 'symlinkSync', 'existsSync', 'writeFileSync']) {
  const original = fs[name]
  const wrap = fn => (...args) => {
    if (!active) return fn(...args)
    const path = String(args[name === 'symlinkSync' ? 1 : 0])
    const nas = path === home || path.startsWith(home + '/')
    const key = (nas ? 'NAS:' : 'image:') + name
    const started = performance.now()
    try {
      if (nas && delay) Atomics.wait(sleeper, 0, 0, delay)
      return fn(...args)
    } finally {
      const row = counts[key] ??= { count: 0, ms: 0 }
      row.count++
      row.ms += performance.now() - started
      if (nas) {
        const stack = new Error().stack.split('\n').slice(3, 6).join(' | ')
        stacks[stack] = (stacks[stack] || 0) + 1
      }
    }
  }
  fs[name] = wrap(original)
  if (original.native) fs[name].native = wrap(original.native)
}
syncBuiltinESMExports()
function report() {
  if (!active) return
  active = false
  process.stderr.write('[startup-profile] ' + JSON.stringify({
    elapsedMs: performance.now() - start, counts,
    stacks: Object.entries(stacks).sort((a, b) => b[1] - a[1]).slice(0, 15),
  }) + '\n')
}
for (const stream of [process.stdout, process.stderr]) {
  const write = stream.write
  stream.write = function (chunk, ...args) {
    if (String(chunk).includes('phase=activate;')) report()
    return write.call(this, chunk, ...args)
  }
}
setTimeout(report, 60000).unref()
