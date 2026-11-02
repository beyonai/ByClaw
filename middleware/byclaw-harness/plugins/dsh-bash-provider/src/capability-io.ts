/**
 * Filesystem side of capability probing, and the live memory readings the
 * guard takes per command.
 *
 * {@link ../capability capability.ts} holds every parsing and derivation rule as
 * a pure function; this module is the thin, untested-by-fixture layer that
 * actually touches `/sys/fs/cgroup` and `/proc`. The split exists so the matrix
 * of hosts the guard must survive — cgroup v1 and v2, private and host
 * namespaces, limited and unlimited containers — is covered by unit tests
 * rather than by running on each one.
 *
 * Every read here is best-effort and returns `undefined` on any failure. A
 * guard that throws while inspecting an unfamiliar host would take the Bash
 * provider down with it, which is far worse than running unguarded; the
 * capability snapshot degrades instead, and the status tool reports how far.
 *
 * @module @byclaw/dsh-bash-provider/capability-io
 */

import { mkdirSync, readFileSync, rmdirSync, statfsSync } from 'node:fs'
import { cpus } from 'node:os'
import { join } from 'node:path'
import {
  CGROUP_MOUNT,
  type Capability,
  type CapabilityProbeIo,
  type CgroupVersion,
  parseMemoryEvents,
  probeCapability,
} from './capability.ts'

/** `statfs` magic for a cgroup v2 mount. cgroup v1 presents as tmpfs instead. */
const CGROUP2_MAGIC = 0x63677270

/** Probe directory name, unique enough that a leftover cannot collide with a real task cgroup. */
const WRITE_PROBE_DIR = '.dsh-guard-write-probe'

/**
 * Read a file, swallowing every failure.
 *
 * @param path - absolute path to read.
 * @returns the contents, or undefined when the file is missing or unreadable.
 */
function readFileOrUndefined(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

/**
 * Detect which cgroup hierarchy is mounted.
 *
 * The v2 check is the filesystem magic rather than the presence of any file,
 * because a v1 hybrid mount also has plausible-looking entries at the root. A
 * mount point that is neither cgroup2 nor a tmpfs holding a `memory` controller
 * counts as no hierarchy at all.
 *
 * @param mount - the cgroup mount point.
 * @returns the detected hierarchy version.
 */
function detectCgroupVersion(mount: string): CgroupVersion {
  try {
    if (statfsSync(mount).type === CGROUP2_MAGIC) return 'v2'
  } catch {
    return 'none'
  }
  // Not cgroup2: a v1 hierarchy mounts each controller as its own subdirectory.
  try {
    statfsSync(join(mount, 'memory'))
    return 'v1'
  } catch {
    return 'none'
  }
}

/**
 * Test whether a sub-cgroup can be created, by creating one and removing it.
 *
 * This is the tier A precondition. It is a real `mkdir` rather than a
 * permission inspection because a read-only mount, a missing delegation and an
 * ownership mismatch all present differently through `stat` but identically
 * through the operation that matters.
 *
 * @param dir - this process's own cgroup directory.
 * @returns true when a sub-cgroup was created and cleaned up.
 */
function canCreateSubCgroup(dir: string): boolean {
  const probe = join(dir, WRITE_PROBE_DIR)
  try {
    mkdirSync(probe)
  } catch {
    return false
  }
  try {
    rmdirSync(probe)
  } catch {
    // Created but not removable: writability is proven, and an empty stray
    // cgroup is harmless — it holds no processes and no limits.
  }
  return true
}

/** The real filesystem, injected into the pure prober. */
export const NODE_PROBE_IO: CapabilityProbeIo = {
  readFile: readFileOrUndefined,
  canCreateSubCgroup,
  cgroupVersion: detectCgroupVersion,
}

/**
 * Probe this host once.
 *
 * @param mount - cgroup mount point; overridable for tests.
 * @returns the capability snapshot to cache for the process's lifetime.
 */
export function probeHost(mount: string = CGROUP_MOUNT): Capability {
  return probeCapability(NODE_PROBE_IO, mount)
}

/**
 * Read `MemAvailable` from `/proc/meminfo`.
 *
 * This is the fallback headroom figure when no cgroup ceiling exists: on an
 * unlimited container the host's own free memory is the only real bound, and
 * it is what the host-wide OOM killer will act on.
 *
 * @param read - file reader, injected for tests.
 * @returns available bytes, or undefined when unreadable.
 */
export function readMemAvailableBytes(
  read: (path: string) => string | undefined = readFileOrUndefined,
): number | undefined {
  const content = read('/proc/meminfo')
  if (content === undefined) return undefined
  for (const line of content.split('\n')) {
    const match = /^MemAvailable:\s+(\d+)\s*kB/.exec(line)
    if (match?.[1] === undefined) continue
    const kb = Number(match[1])
    return Number.isSafeInteger(kb) ? kb * 1024 : undefined
  }
  return undefined
}

/**
 * Current memory charged to a cgroup.
 *
 * @param capability - the cached snapshot, for the cgroup path and version.
 * @param read - file reader, injected for tests.
 * @returns bytes in use, or undefined when unreadable.
 */
export function readCgroupCurrentBytes(
  capability: Capability,
  read: (path: string) => string | undefined = readFileOrUndefined,
): number | undefined {
  if (capability.cgroupPath === undefined || capability.version === 'none') return undefined
  const file = capability.version === 'v2' ? 'memory.current' : 'memory.usage_in_bytes'
  const raw = read(`${capability.cgroupPath}/${file}`)
  if (raw === undefined) return undefined
  const value = Number(raw.trim())
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

/**
 * Headroom a build may use: the cgroup ceiling minus what is already charged,
 * falling back to host `MemAvailable` when there is no ceiling.
 *
 * The result is clamped at zero rather than allowed to go negative — a cgroup
 * can briefly report usage above its own limit, and a negative figure would
 * flow into parallelism derivation as if memory were unknown.
 *
 * @param capability - the cached snapshot.
 * @param read - file reader, injected for tests.
 * @returns usable bytes, or undefined when nothing could be read.
 */
export function readAvailableBytes(
  capability: Capability,
  read: (path: string) => string | undefined = readFileOrUndefined,
): number | undefined {
  if (capability.memoryLimitBytes !== undefined) {
    const current = readCgroupCurrentBytes(capability, read)
    if (current !== undefined) return Math.max(0, capability.memoryLimitBytes - current)
    return capability.memoryLimitBytes
  }
  return readMemAvailableBytes(read)
}

/** Which counter {@link readOomCounter} sampled, which sets how much a rise proves. */
export type OomCounterKind = 'v2-oom-kill' | 'v1-failcnt' | 'none'

/**
 * The OOM counter kind available on this host.
 *
 * @param capability - the cached snapshot.
 * @returns the counter kind to record alongside samples.
 */
export function oomCounterKind(capability: Capability): OomCounterKind {
  if (!capability.oomCounterReadable) return 'none'
  return capability.version === 'v2' ? 'v2-oom-kill' : 'v1-failcnt'
}

/**
 * Sample the cgroup's OOM counter.
 *
 * Readable even on a read-only cgroupfs, which is what lets an exit code of 137
 * be corroborated rather than guessed at. On v1 the only counter available is
 * `memory.failcnt`, which counts limit hits rather than kills — a weaker signal
 * that {@link ../oom-evidence oom-evidence.ts} discloses in its advisory.
 *
 * @param capability - the cached snapshot.
 * @param read - file reader, injected for tests.
 * @returns the counter, or undefined when unreadable.
 */
export function readOomCounter(
  capability: Capability,
  read: (path: string) => string | undefined = readFileOrUndefined,
): number | undefined {
  if (capability.cgroupPath === undefined) return undefined
  if (capability.version === 'v2') {
    return parseMemoryEvents(read(`${capability.cgroupPath}/memory.events`), 'oom_kill')
  }
  if (capability.version === 'v1') {
    const raw = read(`${capability.cgroupPath}/memory.failcnt`)
    if (raw === undefined) return undefined
    const value = Number(raw.trim())
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined
  }
  return undefined
}

/**
 * Logical CPU count, floored at 1.
 *
 * @returns the number of logical CPUs visible to this process.
 */
export function cpuCount(): number {
  return Math.max(1, cpus().length)
}
