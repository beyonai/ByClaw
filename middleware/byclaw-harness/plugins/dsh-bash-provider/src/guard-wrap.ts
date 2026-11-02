/**
 * Guard command wrapping. Pure, side-effect-free: given what probing found and
 * how the guard is configured, produce the shell prefix that marks a build as a
 * preferred OOM victim (and optionally caps its address space), plus the
 * `MAKEFLAGS` value that bounds its parallelism.
 *
 * ## Why `oom_score_adj` rather than a sub-cgroup
 *
 * The original goal — "a compile that exhausts memory kills only the compile,
 * never the agent" — is normally met with a per-task sub-cgroup. That needs a
 * writable cgroupfs, which neither k8s Pods nor default docker provide, and
 * which should not be unlocked with `--privileged` just for this.
 *
 * A process may **raise** its own `oom_score_adj` with no capability at all;
 * only lowering one needs `CAP_SYS_RESOURCE`. That asymmetry points the right
 * way: instead of protecting the agent (impossible without privilege), push the
 * build up the kill list until it is the overwhelming favourite. The effect is
 * the same, and the value is inherited across `fork`/`exec`, so one prefix
 * covers the whole compile tree.
 *
 * This works against **both** the cgroup OOM killer (tier A/B, when the
 * container hits its own ceiling) and the host-wide OOM killer (tier C, when no
 * ceiling is set) — `oom_score_adj` lives in `/proc`, so it is indifferent to
 * cgroup version and to whether any limit exists. It is the one mitigation here
 * that pays off in every environment, including an unlimited container where
 * nothing else applies.
 *
 * It buys nothing when `memory.oom.group` is 1, since the kernel then kills
 * every process in the cgroup together; {@link guardPrefix} omits it in that
 * case rather than implying protection that is not there.
 *
 * ## Ordering constraint
 *
 * The prefix contains `>` and `;`, both of which are in `rtk-wrap`'s
 * {@link ../rtk-wrap SHELL_METACHARACTER} set. Prepending it before
 * `wrapWithRtk` would disqualify every command from rtk routing and silently
 * forfeit that output compression — `cargo build` and `go build` are both heavy
 * *and* rtk-eligible, so this is not hypothetical. Callers must wrap with rtk
 * first and apply this prefix second.
 *
 * @module @byclaw/dsh-bash-provider/guard-wrap
 */

/** How the guard is tuned; every field has a defaulted counterpart in the plugin config. */
export interface GuardSettings {
  /** `oom_score_adj` for build processes, 1..1000. Higher means killed sooner. */
  readonly oomScoreAdj: number
  /** Estimated peak memory of one compile job, in MiB, used to derive parallelism. */
  readonly memPerJobMb: number
  /** Upper bound on derived parallelism, independent of available memory. */
  readonly maxJobs: number
  /** Whether to apply an `ulimit -v` address-space backstop. Off by default. */
  readonly ulimitEnabled: boolean
}

/** Defaults chosen to be conservative: bound the damage, do not micro-manage the build. */
export const DEFAULT_GUARD_SETTINGS: GuardSettings = {
  oomScoreAdj: 800,
  memPerJobMb: 1536,
  maxJobs: 16,
  ulimitEnabled: false,
}

/** Parallelism used when no memory figure could be read at all. */
export const FALLBACK_JOBS = 2

/**
 * Derive a job count from the memory a build may use.
 *
 * @param availableBytes - headroom for this build, or undefined when unknown.
 * @param settings - guard tuning.
 * @param cpuCount - logical CPUs; more jobs than cores only adds contention.
 * @returns a job count of at least 1.
 */
export function deriveJobs(
  availableBytes: number | undefined,
  settings: GuardSettings,
  cpuCount: number,
): number {
  const ceiling = Math.max(1, Math.min(settings.maxJobs, Math.floor(cpuCount)))
  if (availableBytes === undefined || !Number.isFinite(availableBytes)) {
    return Math.min(FALLBACK_JOBS, ceiling)
  }
  const perJobBytes = settings.memPerJobMb * 1024 * 1024
  const byMemory = Math.floor(availableBytes / perJobBytes)
  return Math.max(1, Math.min(byMemory, ceiling))
}

/**
 * Render the `MAKEFLAGS` value for a job count.
 *
 * Parallelism is delivered through the environment rather than by rewriting
 * `-j` in the command text. A regex rewrite has to distinguish a real `-j` flag
 * from the same characters inside a quoted argument or a path, and gets it
 * wrong often enough to corrupt commands; `MAKEFLAGS` is read by make and ninja
 * without touching what the model wrote. A `-j` the model wrote explicitly
 * still wins, which is the correct precedence — an explicit choice should not
 * be silently overridden.
 *
 * @param jobs - the derived job count.
 * @returns the value to set as `MAKEFLAGS`.
 */
export function makeflagsValue(jobs: number): string {
  return `-j${String(Math.max(1, Math.floor(jobs)))}`
}

/** What {@link guardPrefix} needs to know about the host, narrowed from `Capability`. */
export interface GuardContext {
  /** True when `memory.oom.group` is 1, which makes victim steering pointless. */
  readonly oomGroupKillsAll: boolean
  /** Headroom for this build in bytes, or undefined when unknown. */
  readonly availableBytes: number | undefined
}

/**
 * Build the shell prefix to prepend to a heavy command.
 *
 * Each clause is individually failure-tolerant: the `oom_score_adj` write is
 * redirected to `/dev/null` and `ulimit` is guarded, because a host that
 * refuses either must still run the build. The prefix therefore never changes
 * a command's exit status on its own.
 *
 * @param context - what probing established about the host.
 * @param settings - guard tuning.
 * @returns the prefix, ending in `; ` when non-empty, or `''` when nothing applies.
 */
export function guardPrefix(context: GuardContext, settings: GuardSettings): string {
  const clauses: string[] = []

  if (!context.oomGroupKillsAll) {
    const adj = Math.max(1, Math.min(1000, Math.floor(settings.oomScoreAdj)))
    clauses.push(`echo ${String(adj)} > /proc/self/oom_score_adj 2>/dev/null`)
  }

  if (settings.ulimitEnabled && context.availableBytes !== undefined) {
    // RLIMIT_AS is virtual address space, not resident memory. Go, the JVM and
    // sanitizer builds reserve far more VA than they ever fault in, so this is
    // a coarse backstop against a single runaway process and is off by default.
    const kb = Math.floor(context.availableBytes / 1024)
    if (kb > 0) clauses.push(`ulimit -v ${String(kb)} 2>/dev/null || true`)
  }

  return clauses.length === 0 ? '' : `${clauses.join('; ')}; `
}

/**
 * Prepend the guard prefix to an already-rtk-wrapped command.
 *
 * @param command - the command after {@link ../rtk-wrap wrapWithRtk} has run.
 * @param context - what probing established about the host.
 * @param settings - guard tuning.
 * @returns the command to hand to `bash -c`.
 */
export function prependGuard(
  command: string,
  context: GuardContext,
  settings: GuardSettings,
): string {
  const prefix = guardPrefix(context, settings)
  return prefix.length === 0 ? command : `${prefix}${command}`
}
