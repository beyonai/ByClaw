/**
 * Remove every build output. The build needs this rather than relying on
 * tsdown's own `clean`: tsdown's outDir is the same `lib/` that `tsc -b` writes
 * declarations into, so letting it clean would delete the types emitted moments
 * earlier — and incremental tsc, seeing its `.tsbuildinfo`, would not put them
 * back.
 */
import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packages = fileURLToPath(new URL('../packages', import.meta.url))
for (const dir of readdirSync(packages)) {
  rmSync(join(packages, dir, 'lib'), { recursive: true, force: true })
  rmSync(join(packages, dir, 'tsconfig.tsbuildinfo'), { force: true })
}
console.log('clean: build outputs removed')
