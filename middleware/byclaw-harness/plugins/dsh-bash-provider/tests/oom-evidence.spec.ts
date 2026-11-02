import { describe, expect, it } from 'vitest'
import { type OomSample, SIGKILL_EXIT, judgeOom } from '../src/oom-evidence.ts'

const sample = (overrides: Partial<OomSample> = {}): OomSample => ({
  exitCode: 0,
  counterBefore: 0,
  counterAfter: 0,
  concurrentHeavy: false,
  counterKind: 'v2-oom-kill',
  ...overrides,
})

describe('judgeOom', () => {
  describe('the decision table', () => {
    it('killed + counter rose -> confirmed', () => {
      const verdict = judgeOom(sample({ exitCode: SIGKILL_EXIT, counterAfter: 1 }))
      expect(verdict.confidence).toBe('confirmed')
      expect(verdict.counterRose).toBe(true)
    })

    it('killed + counter flat -> suspected', () => {
      const verdict = judgeOom(sample({ exitCode: SIGKILL_EXIT }))
      expect(verdict.confidence).toBe('suspected')
      expect(verdict.counterRose).toBe(false)
    })

    it('exited normally + counter rose -> pressure', () => {
      const verdict = judgeOom(sample({ exitCode: 0, counterAfter: 2 }))
      expect(verdict.confidence).toBe('pressure')
    })

    it('exited normally + counter flat -> none', () => {
      const verdict = judgeOom(sample())
      expect(verdict.confidence).toBe('none')
      expect(verdict.advisory).toBeUndefined()
    })

    it('an ordinary build failure is not treated as memory', () => {
      expect(judgeOom(sample({ exitCode: 1 })).confidence).toBe('none')
      expect(judgeOom(sample({ exitCode: 2 })).advisory).toBeUndefined()
    })
  })

  describe('unreadable counters fall back to the exit status alone', () => {
    it('killed with no counter readings -> suspected, never confirmed', () => {
      const verdict = judgeOom(sample({
        exitCode: SIGKILL_EXIT,
        counterBefore: undefined,
        counterAfter: undefined,
        counterKind: 'none',
      }))
      expect(verdict.confidence).toBe('suspected')
      expect(verdict.counterRose).toBe(false)
    })

    it('a missing later reading cannot prove a rise', () => {
      expect(judgeOom(sample({
        exitCode: SIGKILL_EXIT,
        counterBefore: 3,
        counterAfter: undefined,
      })).confidence).toBe('suspected')
    })
  })

  describe('confirmed and suspected advisories are distinguishable', () => {
    const confirmed = judgeOom(sample({ exitCode: SIGKILL_EXIT, counterAfter: 1 })).advisory ?? ''
    const suspected = judgeOom(sample({ exitCode: SIGKILL_EXIT })).advisory ?? ''

    it('confirmed states it is not a compile error', () => {
      expect(confirmed).toContain('OUT OF MEMORY (confirmed)')
      expect(confirmed).toContain('NOT a compile error')
    })

    it('suspected hedges and names the alternatives', () => {
      expect(suspected).toContain('POSSIBLE OUT OF MEMORY')
      expect(suspected).toContain('timeout')
      expect(suspected).not.toContain('(confirmed)')
    })

    it('both carry the same retry ladder', () => {
      for (const advisory of [confirmed, suspected]) {
        expect(advisory).toContain('halve the parallelism')
        expect(advisory).toContain('-O0')
        expect(advisory).toContain('more than twice')
      }
    })
  })

  describe('attribution caveats', () => {
    it('concurrent heavy commands make attribution ambiguous and say so', () => {
      const verdict = judgeOom(sample({
        exitCode: SIGKILL_EXIT,
        counterAfter: 1,
        concurrentHeavy: true,
      }))
      expect(verdict.attributionAmbiguous).toBe(true)
      expect(verdict.advisory).toContain('cannot be attributed to this command with certainty')
    })

    it('concurrency without a counter rise is not flagged as ambiguous', () => {
      const verdict = judgeOom(sample({ exitCode: SIGKILL_EXIT, concurrentHeavy: true }))
      expect(verdict.attributionAmbiguous).toBe(false)
    })

    it('a v1 failcnt rise is described as pressure, not a confirmed kill', () => {
      const verdict = judgeOom(sample({
        exitCode: SIGKILL_EXIT,
        counterAfter: 1,
        counterKind: 'v1-failcnt',
      }))
      expect(verdict.advisory).toContain('counts limit hits rather than kills')
    })
  })
})
