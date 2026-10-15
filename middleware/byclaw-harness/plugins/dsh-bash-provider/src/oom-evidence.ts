/**
 * OOM verdicts. Pure, side-effect-free: turn an exit status plus an OOM-kill
 * counter sampled before and after a command into a verdict and the advisory
 * text handed back to the model.
 *
 * ## Why the exit code alone is not enough
 *
 * The conventional test is `exit == 137` (128 + SIGKILL). But SIGKILL reaches a
 * process from many directions that have nothing to do with memory: a harness
 * timeout, an operator's `kill -9`, a k8s eviction, a parent tearing down a
 * process group. Reporting all of those as "out of memory" sends the model off
 * lowering `-j` on a build that was merely slow.
 *
 * cgroup exposes a counter — `memory.events`' `oom_kill` on v2,
 * `memory.failcnt` on v1 — and, crucially, it stays **readable on a read-only
 * cgroupfs**. Sampling it either side of the command turns a guess into
 * evidence: a counter that moved proves the kernel killed something for memory.
 *
 * ## Attribution is approximate, and says so
 *
 * The counter belongs to the whole cgroup, so with concurrent commands a rise
 * cannot be pinned to this one. It is therefore used to *corroborate* a
 * verdict, never as the sole basis for one, and
 * {@link OomVerdict.attributionAmbiguous} marks the readings taken while other
 * heavy commands were in flight so a reader is not misled by a confident-looking
 * message. On v1 the signal is weaker still: `failcnt` counts times the limit
 * was hit, not kills, so a rise means memory pressure rather than a kill.
 *
 * @module @byclaw/dsh-bash-provider/oom-evidence
 */

/** Exit status produced by a process terminated with SIGKILL. */
export const SIGKILL_EXIT = 137

/** How strongly the evidence supports an out-of-memory explanation. */
export type OomConfidence =
  /** Killed, and the OOM counter moved: the kernel reclaimed this for memory. */
  | 'confirmed'
  /** Killed, but no counter movement: could equally be a timeout or external kill. */
  | 'suspected'
  /** Not killed, yet the counter moved: something in the tree died for memory. */
  | 'pressure'
  /** Nothing points at memory. */
  | 'none'

/** The readings a verdict is derived from. */
export interface OomSample {
  /** Exit status of the command, or undefined when it never produced one. */
  readonly exitCode: number | undefined
  /** OOM counter before dispatch, or undefined when unreadable. */
  readonly counterBefore: number | undefined
  /** OOM counter after settlement, or undefined when unreadable. */
  readonly counterAfter: number | undefined
  /** True when other heavy commands shared the cgroup during this command. */
  readonly concurrentHeavy: boolean
  /** Which counter was sampled, which sets how much a rise proves. */
  readonly counterKind: 'v2-oom-kill' | 'v1-failcnt' | 'none'
}

/** A verdict plus the text to surface to the model. */
export interface OomVerdict {
  readonly confidence: OomConfidence
  /** True when the counter rose between the two samples. */
  readonly counterRose: boolean
  /** True when concurrency makes the counter's owner uncertain. */
  readonly attributionAmbiguous: boolean
  /** Model-facing advisory, or undefined when there is nothing worth saying. */
  readonly advisory: string | undefined
}

/**
 * Whether the OOM counter moved between the two samples.
 *
 * @param sample - the readings.
 * @returns true only when both samples were readable and the later one is higher.
 */
function counterRose(sample: OomSample): boolean {
  const { counterBefore, counterAfter } = sample
  if (counterBefore === undefined || counterAfter === undefined) return false
  return counterAfter > counterBefore
}

/**
 * The retry ladder the model should follow after a memory failure. Kept in one
 * place so the guidance cannot drift between confidence levels.
 */
const RETRY_LADDER = [
  'halve the parallelism (down to -j1) and retry',
  'if it still fails, drop the optimization level (-O0) and disable LTO',
  'do not retry the same command with the same parameters more than twice — split the build into smaller targets instead',
].map((step, index) => `  ${String(index + 1)}. ${step}`).join('\n')

/**
 * Compose the advisory text for a verdict.
 *
 * @param confidence - the derived confidence.
 * @param sample - the readings, for the caveats worth stating.
 * @param ambiguous - whether concurrency clouds attribution.
 * @returns the advisory, or undefined when no advice is warranted.
 */
function advisoryFor(
  confidence: OomConfidence,
  sample: OomSample,
  ambiguous: boolean,
): string | undefined {
  if (confidence === 'none') return undefined

  const caveats: string[] = []
  if (ambiguous) {
    caveats.push('Other heavy commands ran concurrently in the same cgroup, so the OOM counter cannot be attributed to this command with certainty.')
  }
  if (sample.counterKind === 'v1-failcnt') {
    caveats.push('This host reports cgroup v1 `memory.failcnt`, which counts limit hits rather than kills, so the signal indicates memory pressure rather than a confirmed kill.')
  }
  const tail = caveats.length === 0 ? '' : `\n\n${caveats.join(' ')}`

  if (confidence === 'confirmed') {
    return [
      'OUT OF MEMORY (confirmed): this command was killed by the kernel for exceeding the memory limit.',
      'This is an environment/resource failure, NOT a compile error — do not read the truncated output as a code defect.',
      'Recovery:',
      RETRY_LADDER,
    ].join('\n') + tail
  }

  if (confidence === 'suspected') {
    return [
      'POSSIBLE OUT OF MEMORY: this command exited 137 (SIGKILL), but the cgroup OOM counter did not move.',
      'A timeout, an external kill, or an eviction produces the same status, so treat memory as one hypothesis rather than the diagnosis.',
      'If the output suggests memory exhaustion:',
      RETRY_LADDER,
    ].join('\n') + tail
  }

  return [
    'MEMORY PRESSURE: the command exited on its own, but the cgroup OOM counter rose while it ran — some process in its tree was killed for memory.',
    'The result may be incomplete even though the exit status looks benign; consider lowering parallelism before trusting it.',
  ].join('\n') + tail
}

/**
 * Derive an OOM verdict from a sample.
 *
 * @param sample - exit status and the counter readings around the command.
 * @returns the verdict and its model-facing advisory.
 */
export function judgeOom(sample: OomSample): OomVerdict {
  const rose = counterRose(sample)
  const killed = sample.exitCode === SIGKILL_EXIT
  const ambiguous = rose && sample.concurrentHeavy

  const confidence: OomConfidence = killed && rose
    ? 'confirmed'
    : killed
      ? 'suspected'
      : rose
        ? 'pressure'
        : 'none'

  return {
    confidence,
    counterRose: rose,
    attributionAmbiguous: ambiguous,
    advisory: advisoryFor(confidence, sample, ambiguous),
  }
}
