/**
 * Workspace layout resolver: from one workspace root to its member packages
 * and their scope ids, mechanically, so scope coverage never depends on a
 * hand-maintained list. Every ecosystem detector in the chain reads its own
 * manifest convention at the root, and the union of the non-null answers —
 * deduplicated by (directory, scope id), the shape a Maven-and-Gradle
 * dual-build repository needs — is the layout. Only when no detector answers
 * does the root's own `package.json` name stand in as a single package.
 *
 * Discovery is root-driven, never a crawl: the member set is exactly what
 * the root manifests declare, and a stray nested project nothing points at —
 * a vendored example, a `playwright/` scenario package — is deliberately not
 * discovered, because a crawl would promote every such manifest to a scope
 * and misreport coverage in the opposite direction from the silent cap this
 * chain exists to remove.
 *
 * Failure posture: every consumer sits on a model-facing path, so resolution
 * failure is never allowed to fail a step — anything unreadable degrades to
 * a logged warning plus the smaller honest answer.
 * @module @zhchxiao123/dsh-devflow-spec-sentinel/src/workspace-layout
 */

import { stat } from 'node:fs/promises'
import { basename, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { isValidSpecId } from '@zhchxiao123/dsh-devflow-spec'
import { DETECTORS, packageJsonName } from './ecosystem-detectors.ts'
import type { EcosystemDetector } from './ecosystem-detectors.ts'
import type { DevflowSpecWorkspace, WorkspaceLayoutResult, WorkspacePackage } from './types.ts'

/** One cached resolution, valid while its manifest fingerprint stands. */
interface LayoutCacheEntry {
  readonly fingerprint: string
  readonly result: WorkspaceLayoutResult
}

/**
 * Observe one file's mtime.
 * @param path - absolute file path.
 * @returns the mtime, or `undefined` when the file does not exist — recorded
 *   rather than skipped, because a manifest appearing later must invalidate
 *   a cached layout as surely as an edit.
 */
async function mtimeOf(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).mtimeMs
  } catch {
    // Absence is the recorded state, not an error.
    return undefined
  }
}

/**
 * Fingerprint the mtime-or-absence of every governing manifest the chain
 * would consult; equal strings mean the member set cannot have changed on
 * the chain's supported surface.
 * @param root - absolute workspace root.
 * @param detectors - the detector chain.
 * @returns the serialized manifest state, deterministic in chain order.
 */
async function manifestFingerprint(root: string, detectors: readonly EcosystemDetector[]): Promise<string> {
  const paths = [...new Set(detectors.flatMap(detector => detector.manifests(root)))]
  const parts: string[] = []
  for (const path of paths) parts.push(`${path}=${await mtimeOf(path) ?? 'absent'}`)
  return parts.join('\n')
}

/**
 * Normalize one detected member to the seam's scope-id syntax — slash-joined
 * segments of `[@a-z0-9][a-z0-9._@-]*`, the same rule spec ids obey. A name
 * outside the syntax falls back to the member's directory name rather than
 * an invented escaping scheme, and when even that is illegal the member is
 * skipped; both degradations are warned about, never silent.
 * @param member - the member as its detector reported it.
 * @param detector - the reporting detector's name, for the warning.
 * @param warn - sink for the degradation warnings.
 * @returns the member, renamed if needed, or `undefined` when skipped.
 */
export function normalizeMember(
  member: WorkspacePackage,
  detector: string,
  warn: (message: string) => void,
): WorkspacePackage | undefined {
  if (isValidSpecId(member.scopeId)) return member
  const dirName = basename(member.dir)
  if (isValidSpecId(dirName)) {
    warn(`devflow-spec-sentinel: the ${detector} package name "${member.scopeId}" at ${member.dir} is not a legal scope id;`
      + ` the directory name "${dirName}" stands in`)
    return { dir: member.dir, scopeId: dirName }
  }
  warn(`devflow-spec-sentinel: neither the ${detector} package name "${member.scopeId}" nor the directory name "${dirName}"`
    + ` at ${member.dir} is a legal scope id; the package is not in the layout`)
  return undefined
}

/**
 * Build the `devflowSpecWorkspace` service value.
 *
 * Results are cached per root and validated by the mtime-or-absence stamp of
 * every governing manifest the chain consults — the multi-ecosystem upgrade
 * of the single-manifest mtime key this resolver started with, chosen over
 * recompute-every-step because one layout read fans out to a manifest per
 * member, and the governing stamps answer "did the member set change"
 * exactly. A member renamed without a governing-manifest touch is served
 * stale until one changes; renaming a package is repository surgery, not a
 * per-step event. The warned no-manifest fallback failure is never cached,
 * so a repaired workspace recovers on the next call.
 * @param ctx - context supplying the warning logger.
 * @param detectors - the detector chain; parameterized so a test can inject
 *   a hostile detector, defaulting to the real {@link DETECTORS}.
 * @returns the service value.
 */
export function createWorkspaceLayout(ctx: Context, detectors: readonly EcosystemDetector[] = DETECTORS): DevflowSpecWorkspace {
  const cache = new Map<string, LayoutCacheEntry>()
  const warn = (message: string): void => { ctx.logger.warn(message) }

  async function discover(root: string): Promise<WorkspaceLayoutResult> {
    const resolvedRoot = resolve(root)
    try {
      const fingerprint = await manifestFingerprint(resolvedRoot, detectors)
      const cached = cache.get(resolvedRoot)
      if (cached !== undefined && cached.fingerprint === fingerprint) return cached.result

      const answered: string[] = []
      const byKey = new Map<string, WorkspacePackage>()
      const admit = (raw: WorkspacePackage, origin: string): void => {
        const member = normalizeMember(raw, origin, warn)
        if (member !== undefined) byKey.set(`${member.dir}\u0000${member.scopeId}`, member)
      }
      for (const detector of detectors) {
        let members: readonly WorkspacePackage[] | null
        try {
          members = await detector.detect(resolvedRoot, warn)
        } catch (error) {
          // One detector must never take the chain down with it.
          warn(`devflow-spec-sentinel: ${detector.name} detection failed for ${resolvedRoot}: ${String(error)}`)
          members = null
        }
        if (members === null) continue
        answered.push(detector.name)
        for (const raw of members) admit(raw, detector.name)
      }

      // The root fallback runs only when every detector returned null: an
      // answered-but-empty detector means a workspace manifest exists whose
      // members could not be read, and papering over that with a
      // single-package answer would be the silent cap all over again.
      if (answered.length === 0) {
        const name = await packageJsonName(resolvedRoot)
        if (name === undefined) {
          warn(`devflow-spec-sentinel: ${resolvedRoot} carries no recognized workspace manifest and no named package.json;`
            + ' workspace layout is empty')
          return { packages: [], detectors: [] }
        }
        admit({ dir: resolvedRoot, scopeId: name }, 'root-package fallback')
      }

      const packages = [...byKey.values()]
        .sort((a, b) => a.dir === b.dir ? a.scopeId.localeCompare(b.scopeId) : a.dir < b.dir ? -1 : 1)
      const result: WorkspaceLayoutResult = { packages, detectors: answered }
      cache.set(resolvedRoot, { fingerprint, result })
      return result
    } catch (error) {
      warn(`devflow-spec-sentinel: workspace layout resolution failed for ${resolvedRoot}: ${String(error)}`)
      return { packages: [], detectors: [] }
    }
  }

  return {
    async layout(root: string): Promise<readonly WorkspacePackage[]> {
      return (await discover(root)).packages
    },
    discover,
  }
}

/**
 * Map one absolute file path to the scope id of the package containing it.
 * @param path - absolute file path.
 * @param layout - the workspace's packages.
 * @returns the deepest containing package's scope id — nested members resolve
 *   to the nearest one — or `undefined` when no package contains the path.
 */
export function scopeOf(path: string, layout: readonly WorkspacePackage[]): string | undefined {
  let best: WorkspacePackage | undefined
  for (const pkg of layout) {
    if (path !== pkg.dir && !path.startsWith(pkg.dir + sep)) continue
    if (best === undefined || pkg.dir.length > best.dir.length) best = pkg
  }
  return best?.scopeId
}
