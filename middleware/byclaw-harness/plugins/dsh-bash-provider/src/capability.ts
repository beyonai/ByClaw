/**
 * Environment capability detection and enforcement-tier derivation.
 *
 * The guard has to run unchanged across k8s Pods, plain docker (with or
 * without `-m`), the current unlimited coderfleet worker, and a developer's
 * bare machine. Those differ along axes that do not correlate — cgroup v1 vs
 * v2, a memory limit set or not, `cgroupns` host vs private, cgroupfs writable
 * or read-only — so branching on "which platform am I on" cannot be made
 * correct. This module instead **probes each axis independently** and derives
 * an enforcement tier from the combination.
 *
 * Every parsing rule lives here as a pure function over already-read file
 * contents, so the matrix of environments this code must survive is covered by
 * unit tests with synthetic fixtures rather than by running on each platform.
 * {@link probeCapability} is the only impure entry point.
 *
 * ## The tiers
 *
 * - **A** — cgroupfs is writable, so per-task sub-cgroups with their own
 *   `memory.max` are possible. Realistically only privileged docker. Detected
 *   and reported, but the sub-cgroup machinery is not implemented; tier A
 *   currently behaves as tier B.
 * - **B** — a kernel-enforced memory ceiling exists on this container and OOM
 *   kills individual processes. The default target for k8s with
 *   `resources.limits.memory` and for docker with `-m`.
 * - **C** — no known ceiling, or `memory.oom.group` is 1 so a single OOM takes
 *   the whole cgroup down with it and steering the victim is pointless.
 *
 * ## Two traps this encodes
 *
 * **`cgroupns=host`.** Under a host cgroup namespace (older docker defaults)
 * `/sys/fs/cgroup` is the *host's* tree, so reading `memory.max` there yields
 * the host root's `max` — reporting "no limit" on a container that was started
 * with `-m`. The container's own cgroup path must come from `/proc/self/cgroup`
 * and be joined onto the mount point. A private namespace reports `0::/`, which
 * is the only case where reading the mount root directly is correct.
 *
 * **cgroup v1's unlimited sentinel.** v1 spells "no limit" as a near-`INT64_MAX`
 * byte count rather than the string `max`, and the exact value varies with page
 * size. Any limit at or above {@link V1_UNLIMITED_FLOOR} is treated as absent.
 *
 * ## Architecture neutrality
 *
 * Nothing here branches on CPU architecture, and it must stay that way — the
 * same compiled `lib/` ships to arm64 and amd64 hosts. The one place the two
 * genuinely differ is page size, which sets that v1 sentinel: amd64 is always
 * 4 KiB, while arm64 kernels are built with 4, 16 or 64 KiB. Matching the exact
 * per-page-size constant would make the check silently wrong on whichever page
 * size was not anticipated, so {@link V1_UNLIMITED_FLOOR} is a floor below every
 * variant and far above every real limit instead.
 *
 * @module @byclaw/dsh-bash-provider/capability
 */

/** Which cgroup hierarchy the host exposes. */
export type CgroupVersion = 'v2' | 'v1' | 'none'

/** Derived enforcement tier; see the module docs for what each one promises. */
export type Tier = 'A' | 'B' | 'C'

/** A named reason the environment fell short of full enforcement. */
export type DegradedReason =
  /** No kernel-enforced memory ceiling: k8s `resources.limits.memory` or docker `-m` is unset. */
  | 'no-limit'
  /** `memory.oom.group` is 1, so one OOM kills every process in the cgroup and victim steering cannot help. */
  | 'oom-group'
  /** The cgroup hierarchy could not be read at all. */
  | 'no-cgroup'
  /** A host cgroup namespace whose own-path join did not resolve to a readable cgroup. */
  | 'cgroupns-host-unresolved'

/** Everything probing learned about the host, plus what it implies. */
export interface Capability {
  readonly version: CgroupVersion
  /** Absolute path of this process's own cgroup directory, when one was resolved. */
  readonly cgroupPath: string | undefined
  /** The kernel-enforced ceiling in bytes, or undefined when unlimited or unreadable. */
  readonly memoryLimitBytes: number | undefined
  /** Whether a sub-cgroup could be created (tier A precondition). */
  readonly cgroupWritable: boolean
  /** `memory.oom.group`; undefined on v1, which has no equivalent. */
  readonly oomGroup: boolean | undefined
  /** Whether an OOM-kill counter is readable, which decides how OOM is confirmed later. */
  readonly oomCounterReadable: boolean
  readonly tier: Tier
  readonly degraded: readonly DegradedReason[]
}

/** Default cgroup mount point; overridable so tests never touch the real one. */
export const CGROUP_MOUNT = '/sys/fs/cgroup'

/**
 * At or above this byte count, a cgroup v1 `memory.limit_in_bytes` means
 * "unlimited".
 *
 * The kernel writes `(LONG_MAX / PAGE_SIZE) * PAGE_SIZE`, so the sentinel is
 * page-size dependent — 9223372036854771712 at 4 KiB (every amd64 kernel and
 * most arm64 ones), 9223372036854759424 at 16 KiB, 9223372036854710272 at
 * 64 KiB (common on arm64 server kernels). Comparing against a floor rather
 * than any one of those constants keeps the check correct on all of them, and
 * on any future page size.
 *
 * 2^53 (~9 PB) sits far above every real container limit — a TiB-scale ceiling
 * is six orders of magnitude below it — and far below every sentinel, so the
 * two ranges cannot be confused.
 */
export const V1_UNLIMITED_FLOOR = 2 ** 53

/**
 * Extract this process's own cgroup path from `/proc/self/cgroup`.
 *
 * v2 lines are `0::<path>`; v1 lines are `<id>:<controllers>:<path>` and only
 * the `memory` controller's path is meaningful here. A v2 `0::/` means a private
 * namespace, where the mount root *is* this cgroup.
 *
 * @param content - verbatim contents of `/proc/self/cgroup`.
 * @returns the cgroup-relative path, or undefined when no usable line exists.
 */
export function parseSelfCgroup(content: string): string | undefined {
  let v1Memory: string | undefined
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const firstColon = trimmed.indexOf(':')
    const secondColon = trimmed.indexOf(':', firstColon + 1)
    if (firstColon === -1 || secondColon === -1) continue
    const controllers = trimmed.slice(firstColon + 1, secondColon)
    const path = trimmed.slice(secondColon + 1)
    if (path.length === 0) continue
    // A v2 unified line has an empty controller field and wins outright.
    if (controllers.length === 0) return path
    if (v1Memory === undefined && controllers.split(',').includes('memory')) {
      v1Memory = path
    }
  }
  return v1Memory
}

/**
 * Join the cgroup mount point with this process's own cgroup path.
 *
 * `/` (a private namespace) resolves to the mount point itself. Any other path
 * is a host-namespace view and must be appended, because the interesting files
 * live under the container's own directory rather than at the tree root.
 *
 * @param mount - the cgroup filesystem mount point.
 * @param selfPath - the path returned by {@link parseSelfCgroup}.
 * @returns the directory holding this cgroup's control files.
 */
export function resolveCgroupDir(mount: string, selfPath: string | undefined): string {
  if (selfPath === undefined || selfPath === '/' || selfPath === '') return mount
  return `${mount}${selfPath.startsWith('/') ? '' : '/'}${selfPath}`
}

/**
 * Interpret a cgroup v2 `memory.max` value.
 *
 * @param raw - verbatim file contents, or undefined when unreadable.
 * @returns the ceiling in bytes, or undefined for `max` and unparsable input.
 */
export function parseV2MemoryMax(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  const value = raw.trim()
  if (value === '' || value === 'max') return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

/**
 * Interpret a cgroup v1 `memory.limit_in_bytes` value, treating the kernel's
 * near-`INT64_MAX` sentinel as unlimited.
 *
 * @param raw - verbatim file contents, or undefined when unreadable.
 * @returns the ceiling in bytes, or undefined when unlimited or unparsable.
 */
export function parseV1MemoryLimit(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  const value = raw.trim()
  if (value === '') return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  if (parsed >= V1_UNLIMITED_FLOOR) return undefined
  return parsed
}

/**
 * Read one counter out of a cgroup v2 `memory.events` flat-keyed file.
 *
 * @param raw - verbatim file contents, or undefined when unreadable.
 * @param key - the event name, e.g. `oom_kill`.
 * @returns the counter, or undefined when absent or unparsable.
 */
export function parseMemoryEvents(raw: string | undefined, key: string): number | undefined {
  if (raw === undefined) return undefined
  for (const line of raw.split('\n')) {
    const [name, value] = line.trim().split(/\s+/)
    if (name !== key || value === undefined) continue
    const parsed = Number(value)
    if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed
  }
  return undefined
}

/** Inputs to tier derivation: what probing found, independent of how it was read. */
export interface CapabilityFacts {
  readonly version: CgroupVersion
  readonly memoryLimitBytes: number | undefined
  readonly cgroupWritable: boolean
  readonly oomGroup: boolean | undefined
  readonly oomCounterReadable: boolean
  /** True when `/proc/self/cgroup` named a path that did not resolve to readable control files. */
  readonly hostNamespaceUnresolved: boolean
}

/**
 * Derive the enforcement tier and the reasons it is not higher.
 *
 * `oom-group` forces tier C even when a limit exists: with `memory.oom.group`
 * set, one process hitting the ceiling takes the agent down with the compile,
 * so raising a build's `oom_score_adj` buys nothing and claiming tier B would
 * overstate the protection.
 *
 * @param facts - what probing established about the host.
 * @returns the tier plus every degraded reason that applies.
 */
export function deriveTier(facts: CapabilityFacts): { tier: Tier; degraded: DegradedReason[] } {
  const degraded: DegradedReason[] = []
  if (facts.version === 'none') degraded.push('no-cgroup')
  if (facts.memoryLimitBytes === undefined) degraded.push('no-limit')
  if (facts.oomGroup === true) degraded.push('oom-group')
  if (facts.hostNamespaceUnresolved) degraded.push('cgroupns-host-unresolved')

  if (facts.oomGroup === true) return { tier: 'C', degraded }
  if (facts.memoryLimitBytes === undefined) return { tier: 'C', degraded }
  if (facts.cgroupWritable) return { tier: 'A', degraded }
  return { tier: 'B', degraded }
}

/** File reads and the writability probe, injected so tests stay off the real filesystem. */
export interface CapabilityProbeIo {
  /** Read a file, returning undefined for any failure. */
  readFile(path: string): string | undefined
  /** Whether a sub-cgroup can be created under `dir`. */
  canCreateSubCgroup(dir: string): boolean
  /** Detect the hierarchy at the mount point. */
  cgroupVersion(mount: string): CgroupVersion
}

/**
 * Probe the host and assemble a {@link Capability}.
 *
 * Every read is best-effort: an unreadable file degrades the result rather than
 * throwing, because a guard that crashes the provider on an unexpected host is
 * strictly worse than one that reports tier C and keeps builds running.
 *
 * @param io - injected filesystem access.
 * @param mount - the cgroup mount point to probe.
 * @returns the capability snapshot to cache for the process's lifetime.
 */
export function probeCapability(io: CapabilityProbeIo, mount: string = CGROUP_MOUNT): Capability {
  try {
    return probeOrThrow(io, mount)
  } catch {
    // The outermost safety boundary. Every production probe already swallows
    // its own errors, but this feature is optional and the Bash provider it
    // lives in is not: a probe that threw for any reason would propagate out
    // of the executor's constructor and take the entire shell surface down.
    // Degrading to "no capability" costs the guard and nothing else.
    return UNKNOWN_CAPABILITY
  }
}

/** What a host whose capabilities could not be established looks like. */
const UNKNOWN_CAPABILITY: Capability = {
  version: 'none',
  cgroupPath: undefined,
  memoryLimitBytes: undefined,
  cgroupWritable: false,
  oomGroup: undefined,
  oomCounterReadable: false,
  tier: 'C',
  degraded: ['no-cgroup'],
}

/**
 * Probe without the safety net; see {@link probeCapability}.
 *
 * @param io - injected filesystem access.
 * @param mount - the cgroup mount point to probe.
 * @returns the capability snapshot.
 */
function probeOrThrow(io: CapabilityProbeIo, mount: string): Capability {
  const version = io.cgroupVersion(mount)
  if (version === 'none') {
    const { tier, degraded } = deriveTier({
      version,
      memoryLimitBytes: undefined,
      cgroupWritable: false,
      oomGroup: undefined,
      oomCounterReadable: false,
      hostNamespaceUnresolved: false,
    })
    return {
      version,
      cgroupPath: undefined,
      memoryLimitBytes: undefined,
      cgroupWritable: false,
      oomGroup: undefined,
      oomCounterReadable: false,
      tier,
      degraded,
    }
  }

  const selfPath = parseSelfCgroup(io.readFile('/proc/self/cgroup') ?? '')
  const dir = resolveCgroupDir(mount, selfPath)
  const isHostNamespace = selfPath !== undefined && selfPath !== '/' && selfPath !== ''

  const limitRaw = version === 'v2'
    ? io.readFile(`${dir}/memory.max`)
    : io.readFile(`${dir}/memory.limit_in_bytes`)
  const memoryLimitBytes = version === 'v2'
    ? parseV2MemoryMax(limitRaw)
    : parseV1MemoryLimit(limitRaw)

  // A host-namespace path that yields no readable limit file means the join
  // failed (a renamed or moved cgroup); say so rather than silently reporting
  // "no limit" on a container that may well have one.
  const hostNamespaceUnresolved = isHostNamespace && limitRaw === undefined

  const oomGroupRaw = version === 'v2' ? io.readFile(`${dir}/memory.oom.group`) : undefined
  const oomGroup = oomGroupRaw === undefined ? undefined : oomGroupRaw.trim() === '1'

  const oomCounterReadable = version === 'v2'
    ? parseMemoryEvents(io.readFile(`${dir}/memory.events`), 'oom_kill') !== undefined
    : io.readFile(`${dir}/memory.failcnt`) !== undefined

  const cgroupWritable = io.canCreateSubCgroup(dir)

  const { tier, degraded } = deriveTier({
    version,
    memoryLimitBytes,
    cgroupWritable,
    oomGroup,
    oomCounterReadable,
    hostNamespaceUnresolved,
  })

  return {
    version,
    cgroupPath: dir,
    memoryLimitBytes,
    cgroupWritable,
    oomGroup,
    oomCounterReadable,
    tier,
    degraded,
  }
}
