/**
 * Discovery survey over the real resolver: given workspace roots, run the
 * spec sentinel's ecosystem detector chain — `createWorkspaceLayout`, the
 * exact code `/devflow spec`'s census rests on — against each root and print
 * one JSON record per root: `{ root, detectors, packages: [{ dir, scopeId }] }`,
 * with `dir` root-relative (`.` is the root itself) so the output compares
 * directly against a hand-written expectation table. Resolver warnings go to
 * stderr; stdout carries only the JSON.
 *
 * This is a manual regression tool, not a test: the real sample repositories
 * it was written for live outside this repository (`/e2e-test-samples/repos/`
 * on the task machine), so nothing in CI runs it. In-repo behavior coverage
 * is the fixture suite in `packages/devflow-spec-sentinel/tests/`. Run this
 * by hand when a detector changes or a new ecosystem lands, against whatever
 * real workspaces are around.
 *
 * Usage: node_modules/.bin/tsx scripts/survey-workspace-discovery.ts [--pretty] <root>...
 */

import { relative, resolve } from 'node:path'
import process from 'node:process'
import { Context } from '@deepseek-ai/cordis'
import { createWorkspaceLayout } from '../packages/devflow-spec-sentinel/src/workspace-layout.ts'

/** One root's surveyed answer, in the shape the expectation table uses. */
interface SurveyRecord {
  readonly root: string
  readonly detectors: readonly string[]
  readonly packages: readonly { readonly dir: string; readonly scopeId: string }[]
}

const args = process.argv.slice(2)
const pretty = args.includes('--pretty')
const roots = args.filter(arg => arg !== '--pretty')
if (roots.length === 0) {
  console.error('usage: tsx scripts/survey-workspace-discovery.ts [--pretty] <root>...')
  process.exit(1)
}

// A bare Context's logger exports nowhere; wiring warnings to stderr keeps
// them visible without polluting the JSON on stdout.
const ctx = new Context()
ctx.logger.exporter({
  levels: { default: 3 },
  export: (message) => {
    if (message.type === 'warn') console.error(message.args.map(String).join(' '))
  },
})
const workspace = createWorkspaceLayout(ctx)

const records: SurveyRecord[] = []
for (const root of roots) {
  const absolute = resolve(root)
  // The service always publishes `discover` (the field is optional only for
  // consumers facing older providers), so its absence is a defect, not a case.
  const discovered = await workspace.discover?.(absolute)
  if (discovered === undefined) throw new Error('createWorkspaceLayout published no discover face')
  const { packages, detectors } = discovered
  records.push({
    root: absolute,
    detectors,
    packages: packages.map(pkg => ({
      dir: relative(absolute, pkg.dir) === '' ? '.' : relative(absolute, pkg.dir),
      scopeId: pkg.scopeId,
    })),
  })
}

console.log(pretty ? JSON.stringify(records, undefined, 2) : JSON.stringify(records))
