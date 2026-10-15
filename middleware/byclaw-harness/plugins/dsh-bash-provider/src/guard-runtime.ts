/**
 * The guard's runtime state: one cached capability snapshot, one slot pool, and
 * the per-command OOM baselines taken between `tools/pre-execute` and
 * `tools/post-execute`.
 *
 * This is the only stateful piece. The decision logic it drives is pure and
 * lives in {@link ../heavy-command heavy-command.ts},
 * {@link ../guard-wrap guard-wrap.ts} and
 * {@link ../oom-evidence oom-evidence.ts}; the host readings come from
 * {@link ../capability-io capability-io.ts}. Keeping the state in one object
 * means the executor and the two hooks share exactly one view of the
 * environment, rather than each probing and possibly disagreeing.
 *
 * ## Probing once
 *
 * Capability is probed in the constructor and cached for the process lifetime.
 * Re-probing per command would put several file reads in front of every Bash
 * call for facts that cannot change without the container being replaced. The
 * live readings that *do* change — current usage, the OOM counter — are read
 * per command.
 *
 * ## Baselines are bounded
 *
 * A baseline is recorded at pre-execute and consumed at post-execute. A hook
 * pair that never completes (an aborted call, a crash between the two) would
 * otherwise leak an entry per command forever, so the map is capped and evicts
 * oldest-first.
 *
 * @module @byclaw/dsh-bash-provider/guard-runtime
 */

import type { Capability } from './capability.ts'
import {
  type OomCounterKind,
  cpuCount,
  oomCounterKind,
  probeHost,
  readAvailableBytes,
  readOomCounter,
} from './capability-io.ts'
import {
  DEFAULT_GUARD_SETTINGS,
  type GuardSettings,
  deriveJobs,
  makeflagsValue,
  prependGuard,
} from './guard-wrap.ts'
import { isHeavyCommand } from './heavy-command.ts'
import { type OomVerdict, judgeOom } from './oom-evidence.ts'
import {
  DEFAULT_SLOT_SETTINGS,
  type CoordinationKind,
  type SlotHandle,
  type SlotSettings,
  SlotPool,
  inProcessBackend,
} from './slot-lease.ts'

/** Ceiling on tracked baselines, so an unpaired hook cannot grow the map without bound. */
const MAX_PENDING_BASELINES = 256

/** What was recorded before a heavy command was dispatched. */
interface Baseline {
  readonly oomCounter: number | undefined
  readonly concurrentHeavy: boolean
  readonly slot: SlotHandle | undefined
}

/** Everything the guard needs to be configured with. */
export interface GuardConfig {
  /** Master switch. When false every transform is the identity. */
  readonly enabled: boolean
  readonly guard: GuardSettings
  readonly slots: SlotSettings
}

export const DEFAULT_GUARD_CONFIG: GuardConfig = {
  enabled: true,
  guard: DEFAULT_GUARD_SETTINGS,
  slots: DEFAULT_SLOT_SETTINGS,
}

/** The status tool's payload: what is in force, and what it falls short of. */
export interface GuardStatus {
  readonly enabled: boolean
  readonly tier: Capability['tier']
  readonly cgroup: Capability['version']
  readonly cgroupPath: string | undefined
  readonly coordination: CoordinationKind
  readonly degraded: readonly string[]
  readonly memoryLimitBytes: number | undefined
  readonly availableBytes: number | undefined
  readonly oomCounter: number | undefined
  readonly oomCounterKind: OomCounterKind
  readonly slotsConfigured: number
  readonly slotsRunningHere: number
  readonly derivedJobs: number
  readonly settings: {
    readonly oomScoreAdj: number
    readonly memPerJobMb: number
    readonly ulimitEnabled: boolean
    readonly slotWaitMs: number
  }
  /** Caveats a reader needs in order not to over-read the numbers above. */
  readonly caveats: readonly string[]
}

/**
 * Holds the guard's environment view and admission state.
 */
export class GuardRuntime {
  readonly capability: Capability
  private readonly config: GuardConfig
  private pool: SlotPool
  private readonly baselines = new Map<string, Baseline>()

  constructor(config: GuardConfig = DEFAULT_GUARD_CONFIG, capability: Capability = probeHost()) {
    this.config = config
    this.capability = capability
    // Starts narrow so the guard is usable from construction; replaced once a
    // wider backend is confirmed reachable.
    this.pool = new SlotPool(inProcessBackend(), config.slots)
  }

  /** Which coordination domain is in force right now. */
  get coordination(): CoordinationKind {
    return this.pool.kind
  }

  /**
   * Adopt a wider coordination backend once one is confirmed reachable.
   *
   * Replacing the pool does not migrate slots already held. That is deliberate:
   * a held slot is released through its own handle, which closes over the
   * backend that issued it, so in-flight commands settle correctly against the
   * old pool while new ones queue against the new one.
   *
   * @param pool - the pool to adopt.
   */
  adoptPool(pool: SlotPool): void {
    this.pool = pool
  }

  /**
   * Whether this command should be treated as a build.
   *
   * @param command - the raw shell command.
   * @returns true when the guard applies.
   */
  isGuarded(command: string): boolean {
    return this.config.enabled && isHeavyCommand(command)
  }

  /** Bytes a build may use, re-read per command since usage changes. */
  private availableBytes(): number | undefined {
    return readAvailableBytes(this.capability)
  }

  /**
   * Parallelism for a build starting now.
   *
   * @returns the job count to publish through `MAKEFLAGS`.
   */
  jobs(): number {
    return deriveJobs(this.availableBytes(), this.config.guard, cpuCount())
  }

  /**
   * Environment additions for a guarded command.
   *
   * An explicit `-j` the model wrote still wins over `MAKEFLAGS`, which is the
   * right precedence: a deliberate choice should not be silently overridden.
   *
   * @returns variables to overlay onto the command's environment.
   */
  environment(): Record<string, string> {
    if (!this.config.enabled) return {}
    return { MAKEFLAGS: makeflagsValue(this.jobs()) }
  }

  /**
   * Apply the guard prefix to an already-rtk-wrapped command.
   *
   * Must run *after* rtk wrapping: the prefix contains `>` and `;`, which
   * disqualify a command from rtk routing if they are present when rtk decides.
   *
   * @param command - the command after rtk wrapping.
   * @returns the command to hand to `bash -c`.
   */
  wrap(command: string): string {
    if (!this.config.enabled) return command
    return prependGuard(command, {
      oomGroupKillsAll: this.capability.oomGroup === true,
      availableBytes: this.availableBytes(),
    }, this.config.guard)
  }

  /**
   * Evict the oldest baselines once the map exceeds its ceiling.
   */
  private trimBaselines(): void {
    while (this.baselines.size > MAX_PENDING_BASELINES) {
      const oldest = this.baselines.keys().next()
      if (oldest.done === true) return
      this.baselines.delete(oldest.value)
    }
  }

  /**
   * Take a slot and record the pre-dispatch OOM counter.
   *
   * Concurrency is captured here rather than at settlement because what makes
   * attribution ambiguous is whether another build was running *while* this one
   * ran, not whether one happens to be running when it finishes.
   *
   * @param callId - the tool call this baseline belongs to.
   */
  async beginCommand(callId: string): Promise<void> {
    if (!this.config.enabled) return
    const concurrentHeavy = this.pool.running > 0
    const slot = await this.pool.acquire()
    this.baselines.set(callId, {
      oomCounter: readOomCounter(this.capability),
      concurrentHeavy,
      slot,
    })
    this.trimBaselines()
  }

  /**
   * Release the slot and judge whether this command died for memory.
   *
   * @param callId - the tool call being settled.
   * @param exitCode - its exit status, when known.
   * @returns the verdict, or undefined when this command was never guarded.
   */
  async endCommand(callId: string, exitCode: number | undefined): Promise<OomVerdict | undefined> {
    const baseline = this.baselines.get(callId)
    if (baseline === undefined) return undefined
    this.baselines.delete(callId)
    await baseline.slot?.release()

    return judgeOom({
      exitCode,
      counterBefore: baseline.oomCounter,
      counterAfter: readOomCounter(this.capability),
      concurrentHeavy: baseline.concurrentHeavy,
      counterKind: oomCounterKind(this.capability),
    })
  }

  /**
   * Snapshot for the status tool.
   *
   * The caveats matter as much as the numbers: a reader who does not know that
   * `in-process` rations nothing beyond this container, or that tier A is
   * detected but behaves as B, will read this as stronger protection than it is.
   *
   * @returns the current status.
   */
  status(): GuardStatus {
    const available = this.availableBytes()
    const caveats: string[] = []

    if (this.pool.kind === 'in-process') {
      caveats.push('Coordination is in-process: slots ration only this container\'s own commands. Other replicas count independently, so the configured slot count is NOT a global cap.')
    }
    if (this.pool.kind === 'file-lock') {
      caveats.push('Coordination is a shared-directory file lock: it covers processes sharing that directory on one host, and does not span Pods or hosts. Its cross-container semantics over virtiofs/NFS are not guaranteed.')
    }
    if (this.capability.tier === 'A') {
      caveats.push('Tier A (writable cgroup) is detected but per-task sub-cgroups are not implemented; behaviour is identical to tier B.')
    }
    if (this.capability.tier === 'C') {
      caveats.push('Tier C: no kernel-enforced ceiling is in force for this container. Raising oom_score_adj still steers the host OOM killer toward builds, but total memory is not capped.')
    }
    if (this.capability.oomGroup === true) {
      caveats.push('memory.oom.group is 1: one OOM kills every process in the cgroup, so victim steering is disabled.')
    }
    if (this.capability.version === 'v1') {
      caveats.push('cgroup v1 exposes only memory.failcnt, which counts limit hits rather than kills, so OOM confirmation is weaker than on v2.')
    }
    caveats.push('The OOM counter belongs to the whole cgroup, so with concurrent builds a rise cannot be attributed to one command.')

    return {
      enabled: this.config.enabled,
      tier: this.capability.tier,
      cgroup: this.capability.version,
      cgroupPath: this.capability.cgroupPath,
      coordination: this.pool.kind,
      degraded: this.capability.degraded,
      memoryLimitBytes: this.capability.memoryLimitBytes,
      availableBytes: available,
      oomCounter: readOomCounter(this.capability),
      oomCounterKind: oomCounterKind(this.capability),
      slotsConfigured: this.config.slots.slots,
      slotsRunningHere: this.pool.running,
      derivedJobs: deriveJobs(available, this.config.guard, cpuCount()),
      settings: {
        oomScoreAdj: this.config.guard.oomScoreAdj,
        memPerJobMb: this.config.guard.memPerJobMb,
        ulimitEnabled: this.config.guard.ulimitEnabled,
        slotWaitMs: this.config.slots.waitMs,
      },
      caveats,
    }
  }
}

/**
 * Render a status snapshot for a human reading tool output.
 *
 * @param status - the snapshot.
 * @returns a plain-text report.
 */
export function renderGuardStatus(status: GuardStatus): string {
  const mib = (bytes: number | undefined) =>
    bytes === undefined ? 'unknown' : `${String(Math.round(bytes / 1024 / 1024))} MiB`

  const lines = [
    `build guard: ${status.enabled ? 'enabled' : 'DISABLED'}`,
    `  tier          ${status.tier}`,
    `  cgroup        ${status.cgroup}${status.cgroupPath === undefined ? '' : ` at ${status.cgroupPath}`}`,
    `  coordination  ${status.coordination}`,
    `  degraded      ${status.degraded.length === 0 ? '(none)' : status.degraded.join(', ')}`,
    `  memory limit  ${mib(status.memoryLimitBytes)}`,
    `  available     ${mib(status.availableBytes)}`,
    `  oom counter   ${status.oomCounter === undefined ? 'unreadable' : String(status.oomCounter)} (${status.oomCounterKind})`,
    `  slots         ${String(status.slotsRunningHere)} running here / ${String(status.slotsConfigured)} configured`,
    `  derived -j    ${String(status.derivedJobs)}`,
    `  settings      oom_score_adj=${String(status.settings.oomScoreAdj)} mem_per_job=${String(status.settings.memPerJobMb)}MiB ulimit=${status.settings.ulimitEnabled ? 'on' : 'off'}`,
    '',
    'caveats:',
    ...status.caveats.map(caveat => `  - ${caveat}`),
  ]
  return lines.join('\n')
}
