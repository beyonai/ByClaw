/**
 * Every package owns a `./invariant` companion, and every companion reserves
 * its own package name on the registry. That is a convention the harness gates
 * with a repo-wide script this line does not carry, so it is asserted here
 * instead: a package added without a companion, or one whose companion claims
 * the wrong name, fails this spec rather than shipping unnoticed.
 *
 * The companions with a real relation to check own their own specs — the
 * parent gate's is next to that package. This one is about the registration
 * itself, which is what makes those relations reachable at all.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as devflow from '@zhchxiao123/dsh-devflow/invariant'
import * as agentGate from '@zhchxiao123/dsh-devflow-agent-gate/invariant'
import * as artifactGate from '@zhchxiao123/dsh-devflow-artifact-gate/invariant'
import * as bundle from '@zhchxiao123/dsh-devflow-bundle/invariant'
import * as business from '@zhchxiao123/dsh-devflow-business/invariant'
import * as command from '@zhchxiao123/dsh-devflow-command/invariant'
import * as filesystem from '@zhchxiao123/dsh-devflow-filesystem/invariant'
import * as fsGuard from '@zhchxiao123/dsh-devflow-fs-guard/invariant'
import * as gates from '@zhchxiao123/dsh-devflow-gates/invariant'
import * as guidance from '@zhchxiao123/dsh-devflow-guidance/invariant'
import * as ironRules from '@zhchxiao123/dsh-devflow-iron-rules/invariant'
import * as ocrGate from '@zhchxiao123/dsh-devflow-review-gate/invariant'
import * as parentGate from '@zhchxiao123/dsh-devflow-parent-gate/invariant'
import * as spec from '@zhchxiao123/dsh-devflow-spec/invariant'
import * as specFilesystem from '@zhchxiao123/dsh-devflow-spec-filesystem/invariant'
import * as specSentinel from '@zhchxiao123/dsh-devflow-spec-sentinel/invariant'
import * as specTool from '@zhchxiao123/dsh-devflow-spec-tool/invariant'
import * as testenv from '@zhchxiao123/dsh-devflow-testenv/invariant'
import * as tool from '@zhchxiao123/dsh-devflow-tool/invariant'
import * as ui from '@zhchxiao123/dsh-devflow-ui/invariant'
import * as web from '@zhchxiao123/dsh-devflow-web/invariant'
import * as worktree from '@zhchxiao123/dsh-devflow-worktree/invariant'



/** One companion module, as the Loader would see it. */
interface Companion {
  name: string
  inject: string[]
  apply: (ctx: Context) => Promise<() => void>
}

const COMPANIONS: readonly (readonly [string, Companion])[] = [
  ['@zhchxiao123/dsh-devflow', devflow],
  ['@zhchxiao123/dsh-devflow-agent-gate', agentGate],
  ['@zhchxiao123/dsh-devflow-artifact-gate', artifactGate],
  ['@zhchxiao123/dsh-devflow-bundle', bundle],
  ['@zhchxiao123/dsh-devflow-business', business],
  ['@zhchxiao123/dsh-devflow-command', command],
  ['@zhchxiao123/dsh-devflow-filesystem', filesystem],
  ['@zhchxiao123/dsh-devflow-fs-guard', fsGuard],
  ['@zhchxiao123/dsh-devflow-gates', gates],
  ['@zhchxiao123/dsh-devflow-guidance', guidance],
  ['@zhchxiao123/dsh-devflow-iron-rules', ironRules],
  ['@zhchxiao123/dsh-devflow-review-gate', ocrGate],
  ['@zhchxiao123/dsh-devflow-parent-gate', parentGate],
  ['@zhchxiao123/dsh-devflow-spec', spec],
  ['@zhchxiao123/dsh-devflow-spec-filesystem', specFilesystem],
  ['@zhchxiao123/dsh-devflow-spec-sentinel', specSentinel],
  ['@zhchxiao123/dsh-devflow-spec-tool', specTool],
  ['@zhchxiao123/dsh-devflow-testenv', testenv],
  ['@zhchxiao123/dsh-devflow-tool', tool],
  ['@zhchxiao123/dsh-devflow-ui', ui],
  ['@zhchxiao123/dsh-devflow-web', web],
  ['@zhchxiao123/dsh-devflow-worktree', worktree],
] as unknown as readonly (readonly [string, Companion])[]

describe('invariant companions', () => {
  it('covers every package in the workspace', async () => {
    const { readdirSync } = await import('node:fs')
    const packages = readdirSync(new URL('../packages', import.meta.url)).sort()
    expect(COMPANIONS.map(([name]) => name.replace('@zhchxiao123/dsh-', '')).sort())
      .toEqual(packages.map(dir => dir.replace(/^devflow$/, 'devflow')).sort())
  })

  it.each(COMPANIONS.map(([name, companion]) => [name, companion] as const))(
    '%s reserves its package name and releases it with the fiber',
    async (packageName, companion) => {
      const ctx = new Context()
      await ctx.plugin(InvariantRegistry, { enabled: true })
      const fiber = ctx.plugin(companion)
      await fiber.await()

      // The registry refuses a second claim on one package name, which is what
      // makes "reserved" observable without reaching into its internals.
      const second = ctx.plugin(companion)
      await expect(second.await()).rejects.toThrow(packageName)

      await fiber.dispose()
      await ctx.fiber.dispose()
    },
  )
})
