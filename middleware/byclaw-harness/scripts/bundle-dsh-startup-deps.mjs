#!/usr/bin/env node
/** Build-only flattening of private OTel SDK dependencies, preserving shared API registries. */
import { readFile, realpath, mkdtemp, cp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
const root = await realpath(process.argv[2] ?? '/workspace')
const require = createRequire(join(root, 'package.json'))
const { build } = await import(pathToFileURL(require.resolve('tsdown')).href)
for (const [directory, name] of [
  ['packages/telemetry/otel', '@deepseek-ai/dsh-otel'],
  ['packages/host/product-telemetry-otel', '@deepseek-ai/dsh-host-product-telemetry-otel'],
]) {
  const dir = await realpath(join(root, directory))
  if (relative(root, dir).startsWith('..')) throw new Error('Package escapes build workspace')
  const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
  if (manifest.name !== name || manifest.version !== '0.2.1-rc.2') throw new Error(`Expected ${name}@0.2.1-rc.2`)
  // A fresh output directory avoids reading and writing the entry at the same time.
  const outDir = await mkdtemp(join(dir, '.byclaw-startup-'))
  try {
    await build({
      config: false, format: 'esm', platform: 'node', target: 'node22',
      fixedExtension: false, dts: false,
      deps: {
        alwaysBundle: [/^@opentelemetry\/(?!api$|api-logs$)/],
        neverBundle: ['@opentelemetry/api', '@opentelemetry/api-logs'],
        onlyBundle: [/^@opentelemetry\//],
      },
      cwd: dir, entry: ['lib/index.js'], outDir, clean: false,
    })
    // Include dynamic platform-detector chunks, not only index.js.
    await cp(outDir, join(dir, 'lib'), { recursive: true })
  } finally { await rm(outDir, { recursive: true, force: true }) }
}
