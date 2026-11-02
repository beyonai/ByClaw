import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/** DSH fork sources: the plugin builds on the fork's primitives (highlight,
    copy feedback), and the linked packages' `./client` exports point at
    browser bundles (lib/client.js, loader-bannered) — tests must resolve to
    the fork's src instead, like the monorepo's tsconfig paths. */
const colocatedFork = fileURLToPath(new URL('../../packages/client', import.meta.url))
const siblingCheckoutFork = fileURLToPath(new URL('../../../deepseek-harness/packages/client', import.meta.url))
const fork = existsSync(colocatedFork) ? colocatedFork : siblingCheckoutFork

/** React must be ONE instance: the fork's primitives (linked via the monorepo)
    call react hooks that DiffViewer invokes, and two React copies break the
    hook dispatcher. The production bundle keeps react external (a platform
    module), so this is a test-only concern. Array form with the longer
    subpath keys first (object-form aliases prefix-match, so a bare `react`
    key would swallow the jsx-runtime subpaths). */
const require = createRequire(import.meta.url)

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
    environment: 'node',
    pool: 'threads',
  },
  resolve: {
    alias: [
      { find: 'react/jsx-dev-runtime', replacement: require.resolve('react/jsx-dev-runtime') },
      { find: 'react/jsx-runtime', replacement: require.resolve('react/jsx-runtime') },
      { find: 'react-dom', replacement: require.resolve('react-dom') },
      { find: 'react', replacement: require.resolve('react') },
      // The src/ prefix must precede the bare package name (string finds
      // prefix-match) so tests can import fork internals like clipboard.ts.
      { find: '@deepseek-ai/dsh-client-ui-primitives/src/', replacement: `${fork}/ui-primitives/src/` },
      { find: '@deepseek-ai/dsh-client-ui-slots', replacement: `${fork}/ui-slots/src/index.ts` },
      { find: '@deepseek-ai/dsh-client-ui-primitives', replacement: `${fork}/ui-primitives/src/index.ts` },
      { find: '@deepseek-ai/dsh-client-ui-tool/client', replacement: `${fork}/ui-tool/src/client/index.ts` },
      { find: '@deepseek-ai/dsh-client-ui-conversation/client', replacement: `${fork}/ui-conversation/src/client/index.ts` },
      { find: '@deepseek-ai/dsh-client-ui-layout/client', replacement: `${fork}/ui-layout/src/client/index.ts` },
      { find: '@deepseek-ai/dsh-client-locale/client', replacement: `${fork}/locale/src/client/index.ts` },
      { find: '@deepseek-ai/dsh-client-test-runtime', replacement: `${fork}/../test-support/client-runtime/src/index.ts` },
      { find: '@deepseek-ai/dsh-client-test-runtime/client', replacement: `${fork}/../test-support/client-runtime/src/client/index.ts` },
    ],
  },
})
