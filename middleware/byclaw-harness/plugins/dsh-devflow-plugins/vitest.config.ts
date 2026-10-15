import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import tsconfigPaths from 'vite-tsconfig-paths'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

/**
 * Client bundles the specs import as if they were ordinary modules. Each is a
 * loader-factory artifact the harness runs in a browser; `tests/loader-factory.ts`
 * is the module table that runs one here, and this plugin is what lets an
 * `import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'`
 * reach it. Without this the import yields an empty namespace and a `window`
 * reference at module scope.
 */
const CLIENT_BUNDLES = ['@deepseek-ai/dsh-client-ui-renderer/client', '@deepseek-ai/dsh-client-locale/client']

const VIRTUAL = '\0devflow-client-bundle:'
const require = createRequire(import.meta.url)

function clientBundlePlugin(): Plugin {
  return {
    name: 'devflow-client-bundle',
    enforce: 'pre',
    resolveId(source: string) {
      return CLIENT_BUNDLES.includes(source) ? VIRTUAL + source : null
    },
    load(id: string) {
      if (!id.startsWith(VIRTUAL)) return null
      const specifier = id.slice(VIRTUAL.length)
      // Names come from the artifact so this list cannot drift from what the
      // published bundle actually exports.
      const manifest = require.resolve(`${specifier.slice(0, -'/client'.length)}/package.json`)
      const artifact = readFileSync(join(dirname(manifest), 'lib', 'client.js'), 'utf8')
      const names = [...new Set([...artifact.matchAll(/exports\.([A-Za-z_$][\w$]*)\s*=/g)].flatMap(m => m[1] === undefined ? [] : [m[1]]))].sort()
      return [
        `import { loadClientBundle } from ${JSON.stringify(fileURLToPath(new URL('./tests/loader-factory.ts', import.meta.url)))}`,
        `const ns = loadClientBundle(${JSON.stringify(specifier)})`,
        `export const { ${names.join(', ')} } = ns`,
        'export default ns',
      ].join('\n')
    },
  }
}

export default defineConfig({
  plugins: [
    tsconfigPaths({ projects: ['./tsconfig.base.json'] }),
    clientBundlePlugin(),
  ],
  test: {
    // Real process and deployment suites carry their own shorter behavioral
    // deadlines. The outer test budget must leave room for teardown on loaded
    // CI runners instead of racing the behavior being asserted.
    testTimeout: 20_000,
    // `expect.poll` carries its own budget, and its 1s default is the one
    // place that reasoning did not reach: a scheduler or sync run that
    // settles in well under the outer deadline still loses the race on a
    // loaded Windows runner, which reports the last polled value rather
    // than a real disagreement. Raising the ceiling cannot make a passing
    // assertion fail; it only stops a slow host from being read as a defect.
    expect: { poll: { timeout: 10_000 } },
    include: ['packages/*/tests/**/*.spec.ts', 'packages/*/tests/**/*.spec.tsx', 'tests/**/*.spec.ts'],
    server: {
      // Its built bundle imports stylesheets at the top of `lib/index.js`;
      // Vite's transform stubs a css import, Node's ESM loader refuses one.
      // Inlining also makes Vite look for the `.map` the tarball does not
      // ship, which logs a read failure per module — noise, not a failure.
      deps: { inline: [/@deepseek-ai\/dsh-client-ui-primitives/] },
    },
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**'],
      thresholds: { perFile: true, lines: 100, functions: 100, statements: 100, branches: 100 },
    },
  },
})
