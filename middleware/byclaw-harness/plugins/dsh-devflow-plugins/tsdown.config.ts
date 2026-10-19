/**
 * Host-half build: one ESM entry pair per package (`lib/index.js` and the
 * `lib/invariant.js` companion), which is what `main`/`exports` point at and
 * therefore what a consumer actually loads. `tsc -b` emits declarations into
 * `lib/types/`; it does not emit the runtime entries, so publishing without
 * this step ships manifests pointing at files that do not exist.
 *
 * Everything outside the package is external: harness packages arrive from the
 * consumer's own node_modules at the version their profile installed, and
 * bundling a copy of one would give a deployment two module identities for a
 * service that must be a singleton.
 *
 * The browser half of `devflow-ui` is NOT built here — it needs the harness's
 * client-bundle preset (a loader-factory artifact), which is its own slice.
 */
import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig } from 'tsdown'
import type { UserConfig } from 'tsdown'

// Every package's node half, `devflow-ui` included: its `src/index.ts` is an
// empty apply whose only job is to make the plugin visible to the Loader, and
// the browser bundle it declares through `dsh.client` is built separately.
const HOST_PACKAGES = readdirSync('packages')
  .filter(name => existsSync(join('packages', name, 'src/index.ts')))

export default defineConfig(HOST_PACKAGES.map((name): UserConfig => ({
  name,
  entry: [
    `packages/${name}/src/index.ts`,
    `packages/${name}/src/invariant.ts`,
    ...(name === 'devflow-midscene'
      ? ['cli', 'worker', 'runner'].map(entry => `packages/${name}/src/${entry}.ts`)
      : []),
    // The fence's pure reads are their own entry so a consumer reaches them
    // without loading the plugin: this package's index value-imports
    // `@deepseek-ai/dsh-skill`, which `devflow-command` neither declares nor
    // needs in order to read a dispatch record.
    ...(name === 'devflow-worktree' ? [`packages/${name}/src/dispatch.ts`] : []),
  ],
  outDir: `packages/${name}/lib`,
  format: 'esm',
  platform: 'node',
  // `.js`, not tsdown's default `.mjs`: every manifest here declares
  // `"type": "module"` and points `exports` at `lib/index.js`.
  outExtensions: () => ({ js: '.js' }),
  dts: false,
  sourcemap: true,
  // `lib/` also holds the declarations `tsc -b` wrote; tsdown's default clean
  // would delete them, and incremental tsc would not write them again.
  // `pnpm run clean` owns removing outputs.
  clean: false,
  // Only this package's own sources are inlined; every bare specifier stays a
  // runtime import the consumer's installer resolved.
  external: [/^[^./]/, /^@[^/]+\//],
})))
