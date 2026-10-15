import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GUARD_SETTINGS,
  FALLBACK_JOBS,
  type GuardSettings,
  deriveJobs,
  guardPrefix,
  makeflagsValue,
  prependGuard,
} from '../src/guard-wrap.ts'
import { wrapWithRtk } from '../src/rtk-wrap.ts'

const MiB = 1024 * 1024
const settings = (overrides: Partial<GuardSettings> = {}): GuardSettings =>
  ({ ...DEFAULT_GUARD_SETTINGS, ...overrides })

describe('deriveJobs', () => {
  it('divides available memory by the per-job estimate', () => {
    // 8 GiB / 1536 MiB = 5 jobs.
    expect(deriveJobs(8192 * MiB, settings(), 16)).toBe(5)
  })

  it('never returns less than one job, however little memory is free', () => {
    expect(deriveJobs(1 * MiB, settings(), 16)).toBe(1)
    expect(deriveJobs(0, settings(), 16)).toBe(1)
  })

  it('is capped by maxJobs', () => {
    expect(deriveJobs(1024 * 1024 * MiB, settings({ maxJobs: 4 }), 64)).toBe(4)
  })

  it('is capped by the CPU count, since extra jobs only add contention', () => {
    expect(deriveJobs(1024 * 1024 * MiB, settings(), 2)).toBe(2)
  })

  it('falls back to a conservative count when memory is unknown', () => {
    expect(deriveJobs(undefined, settings(), 16)).toBe(FALLBACK_JOBS)
  })

  it('keeps the fallback within the CPU ceiling', () => {
    expect(deriveJobs(undefined, settings(), 1)).toBe(1)
  })
})

describe('makeflagsValue', () => {
  it('renders the make parallelism flag', () => {
    expect(makeflagsValue(4)).toBe('-j4')
    expect(makeflagsValue(1)).toBe('-j1')
  })

  it('never renders a non-positive job count', () => {
    expect(makeflagsValue(0)).toBe('-j1')
    expect(makeflagsValue(-3)).toBe('-j1')
  })
})

describe('guardPrefix', () => {
  const host = { oomGroupKillsAll: false, availableBytes: 4096 * MiB }

  it('raises oom_score_adj so the build is the preferred OOM victim', () => {
    expect(guardPrefix(host, settings()))
      .toBe('echo 800 > /proc/self/oom_score_adj 2>/dev/null; ')
  })

  it('tolerates a host that refuses the write, so the build still runs', () => {
    expect(guardPrefix(host, settings())).toContain('2>/dev/null')
  })

  it('omits victim steering when memory.oom.group kills the whole cgroup', () => {
    expect(guardPrefix({ ...host, oomGroupKillsAll: true }, settings())).toBe('')
  })

  it('clamps oom_score_adj into the kernel-accepted range', () => {
    expect(guardPrefix(host, settings({ oomScoreAdj: 5000 }))).toContain('echo 1000 ')
    expect(guardPrefix(host, settings({ oomScoreAdj: -20 }))).toContain('echo 1 ')
  })

  it('omits the ulimit backstop by default', () => {
    expect(guardPrefix(host, settings())).not.toContain('ulimit')
  })

  it('adds the ulimit backstop only when enabled', () => {
    const prefix = guardPrefix(host, settings({ ulimitEnabled: true }))
    expect(prefix).toContain(`ulimit -v ${String(4096 * 1024)} `)
    expect(prefix).toContain('|| true')
  })

  it('skips the ulimit backstop when no memory figure is known', () => {
    const prefix = guardPrefix(
      { oomGroupKillsAll: false, availableBytes: undefined },
      settings({ ulimitEnabled: true }),
    )
    expect(prefix).not.toContain('ulimit')
  })

  it('emits nothing at all when every clause is suppressed', () => {
    expect(guardPrefix(
      { oomGroupKillsAll: true, availableBytes: undefined },
      settings({ ulimitEnabled: true }),
    )).toBe('')
  })
})

describe('prependGuard', () => {
  const host = { oomGroupKillsAll: false, availableBytes: 4096 * MiB }

  it('prefixes the command', () => {
    expect(prependGuard('make all', host, settings()))
      .toBe('echo 800 > /proc/self/oom_score_adj 2>/dev/null; make all')
  })

  it('returns the command untouched when nothing applies', () => {
    expect(prependGuard('make all', { ...host, oomGroupKillsAll: true }, settings()))
      .toBe('make all')
  })
})

describe('ordering against rtk wrapping', () => {
  const host = { oomGroupKillsAll: false, availableBytes: 4096 * MiB }

  it('rtk first, then the guard prefix, keeps both transforms', () => {
    const wrapped = wrapWithRtk('cargo build --release', true)
    expect(wrapped).toBe('rtk cargo build --release')
    const guarded = prependGuard(wrapped, host, settings())
    expect(guarded).toContain('oom_score_adj')
    expect(guarded).toContain('rtk cargo build --release')
  })

  it('the guard prefix first would disqualify the command from rtk routing', () => {
    // The prefix contains `>` and `;`, both in rtk-wrap's metacharacter set.
    // This asserts the hazard the ordering rule exists to avoid: applying the
    // guard first silently forfeits rtk's output compression, with no error.
    const guardedFirst = prependGuard('cargo build --release', host, settings())
    expect(wrapWithRtk(guardedFirst, true)).toBe(guardedFirst)
    expect(wrapWithRtk(guardedFirst, true)).not.toContain('rtk cargo')
  })
})
