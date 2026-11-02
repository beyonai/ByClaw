// What a checker is asked, what its answer is taken to mean, and what the
// coverage account refuses to accept. These are the decisions the gate makes
// about a reply rather than about the code — a lenient verdict parser or a
// forgiving coverage account is how an unreviewed file becomes a passing
// review.
import { describe, expect, it } from 'vitest'
import {
  CHECKER_CONTRACT,
  accountCoverage,
  buildCheckerPrompt,
  parseCheckerVerdict,
  vetoes,
} from '@zhchxiao123/dsh-devflow-review-gate/src/checker.ts'
import { ReviewError } from '@zhchxiao123/dsh-devflow-review-gate/src/ocr.ts'
import type { CheckerVerdict, FileDiff } from '@zhchxiao123/dsh-devflow-review-gate/src/types.ts'

const CARD = { id: '0042-retry-backoff', title: 'Retry with backoff', body: 'Retries must back off.\n' }

const DIFF = (over: Partial<FileDiff> = {}): FileDiff =>
  ({ path: 'src.ts', status: 'modified', text: '@@ -1 +1 @@\n-a\n+b', whole: false, ...over })

describe('the checker prompt', () => {
  it('carries the card, the rule, and every file', () => {
    const prompt = buildCheckerPrompt(CARD, 'developing->reviewing', 'RULE BODY', [
      DIFF(),
      DIFF({ path: 'new.ts', status: 'added', text: 'export const x = 1', whole: true }),
    ])
    expect(prompt).toContain('devflow card 0042-retry-backoff on edge developing->reviewing')
    expect(prompt).toContain('Retry with backoff')
    expect(prompt).toContain('Retries must back off.')
    expect(prompt).toContain('RULE BODY')
    expect(prompt).toContain('--- file src.ts (modified) ---')
    expect(prompt).toContain('--- file new.ts (added) — new file, shown in full ---')
  })

  it('passes the rule through unedited, it being the project standard', () => {
    const rule = 'Before reporting a non-local claim, use `file_read` and `code_search`.'
    expect(buildCheckerPrompt(CARD, 'developing->reviewing', rule, [DIFF()])).toContain(rule)
  })

  // The rule above is real: open-code-review's built-in Go ruleset names the
  // tools of its own agent, which a checker here does not have.
  it('disambiguates those tool names in the contract instead of rewriting the rule', () => {
    expect(CHECKER_CONTRACT).toContain('`file_read`')
    expect(CHECKER_CONTRACT).toContain('use whichever equivalent tools you actually have')
  })

  it('tells the checker that every file must be accounted for', () => {
    expect(CHECKER_CONTRACT).toContain('must end up in `reviewed` or in `skipped`')
  })
})

describe('reading the verdict back', () => {
  it('accepts a complete verdict', () => {
    const verdict = parseCheckerVerdict('Here you go.\n```json\n'
      + '{"reviewed":["a.ts"],"skipped":[{"path":"b.bin","reason":"binary"}],'
      + '"comments":[{"path":"a.ts","content":"leak","start_line":3,"end_line":4,"category":"bug","severity":"high"}]}'
      + '\n```')
    expect(verdict.reviewed).toEqual(['a.ts'])
    expect(verdict.skipped).toEqual([{ path: 'b.bin', reason: 'binary' }])
    expect(verdict.comments).toEqual([
      { path: 'a.ts', content: 'leak', startLine: 3, endLine: 4, category: 'bug', severity: 'high' },
    ])
  })

  it('takes the last block, so a checker may quote the contract', () => {
    const verdict = parseCheckerVerdict([
      'The contract said:',
      '```json',
      '{"reviewed":["example.ts"],"skipped":[],"comments":[]}',
      '```',
      'My answer:',
      '```json',
      '{"reviewed":["real.ts"],"skipped":[],"comments":[]}',
      '```',
    ].join('\n'))
    expect(verdict.reviewed).toEqual(['real.ts'])
  })

  it('skips a trailing block that is not a verdict at all', () => {
    const verdict = parseCheckerVerdict([
      '```json',
      '{"reviewed":["real.ts"],"skipped":[],"comments":[]}',
      '```',
      '```sh',
      'npm test',
      '```',
    ].join('\n'))
    expect(verdict.reviewed).toEqual(['real.ts'])
  })

  it('treats absent lists as empty, a clean review needing no findings', () => {
    expect(parseCheckerVerdict('```json\n{"reviewed":["a.ts"]}\n```')).toEqual({
      reviewed: ['a.ts'], skipped: [], comments: [],
    })
  })

  it('drops a line number of zero, which is the CLI spelling of "unplaced"', () => {
    const verdict = parseCheckerVerdict('```json\n'
      + '{"comments":[{"path":"a.ts","content":"somewhere","start_line":0,"end_line":0,"severity":"low"}]}\n```')
    expect(verdict.comments[0]).toEqual({ path: 'a.ts', content: 'somewhere', severity: 'low' })
  })

  it('carries a category it has never seen through verbatim', () => {
    const verdict = parseCheckerVerdict('```json\n'
      + '{"comments":[{"path":"a.ts","content":"x","severity":"low","category":"accessibility"}]}\n```')
    expect(verdict.comments[0].category).toBe('accessibility')
  })

  it.each([
    ['no fenced block at all', 'I reviewed everything and it is fine.'],
    ['a block that is not JSON', '```json\nnot json\n```'],
    ['a JSON array rather than an object', '```json\n[]\n```'],
    ['a non-string entry in reviewed', '```json\n{"reviewed":[7]}\n```'],
    ['a reviewed field that is not an array', '```json\n{"reviewed":"a.ts"}\n```'],
    ['a skipped field that is not an array', '```json\n{"skipped":"none"}\n```'],
    ['a skip entry that is not an object', '```json\n{"skipped":["a.ts"]}\n```'],
    ['a skip entry that is null', '```json\n{"skipped":[null]}\n```'],
    ['a skip without a path', '```json\n{"skipped":[{"reason":"binary"}]}\n```'],
    ['a skip without a reason', '```json\n{"skipped":[{"path":"a.ts"}]}\n```'],
    ['a skip with a blank reason', '```json\n{"skipped":[{"path":"a.ts","reason":"  "}]}\n```'],
    ['a comments field that is not an array', '```json\n{"comments":"none"}\n```'],
    ['a finding that is not an object', '```json\n{"comments":["a leak"]}\n```'],
    ['a finding that is null', '```json\n{"comments":[null]}\n```'],
    ['a finding without a path', '```json\n{"comments":[{"content":"x","severity":"low"}]}\n```'],
    ['a finding with blank content', '```json\n{"comments":[{"path":"a.ts","content":"  ","severity":"low"}]}\n```'],
    ['a finding with no content', '```json\n{"comments":[{"path":"a.ts","severity":"low"}]}\n```'],
    ['a finding with a severity off the ladder', '```json\n{"comments":[{"path":"a.ts","content":"x","severity":"blocker"}]}\n```'],
    ['a finding with no severity at all', '```json\n{"comments":[{"path":"a.ts","content":"x"}]}\n```'],
  ])('rejects %s', (_label, reply) => {
    expect(() => parseCheckerVerdict(reply)).toThrow(ReviewError)
    expect(() => parseCheckerVerdict(reply)).toThrow('without a parsable verdict block')
  })
})

describe('the coverage account', () => {
  const verdict = (over: Partial<CheckerVerdict> = {}): CheckerVerdict =>
    ({ reviewed: [], skipped: [], comments: [], ...over })

  it('adds up across groups', () => {
    const account = accountCoverage(['a.ts', 'b.ts', 'c.bin'], [
      verdict({ reviewed: ['a.ts'] }),
      verdict({ reviewed: ['b.ts'], skipped: [{ path: 'c.bin', reason: 'binary' }] }),
    ])
    expect(account).toEqual({
      totalFiles: 3,
      reviewedFiles: 2,
      skippedFiles: 1,
      coverageRate: 66.7,
      skipped: [{ path: 'c.bin', reason: 'binary' }],
    })
  })

  it('refuses a review that silently left a file out', () => {
    expect(() => accountCoverage(['a.ts', 'forgotten.ts'], [verdict({ reviewed: ['a.ts'] })]))
      .toThrow('accounted for neither reviewing nor skipping forgotten.ts')
  })

  it('refuses a checker that claims a file outside its scope', () => {
    expect(() => accountCoverage(['a.ts'], [verdict({ reviewed: ['a.ts', 'elsewhere.ts'] })]))
      .toThrow('reported reviewing elsewhere.ts, which was not in its review scope')
  })

  it('refuses a skip for a file outside its scope', () => {
    expect(() => accountCoverage(['a.ts'], [verdict({ reviewed: ['a.ts'], skipped: [{ path: 'x.ts', reason: 'no' }] })]))
      .toThrow('reported skipping x.ts, which was not in its review scope')
  })

  // A path the preview reported twice can legitimately reach two groups, and
  // the two checkers need not agree. Reviewed wins either way round, so the
  // account does not depend on which verdict arrived first.
  it('counts a file skipped then reviewed as reviewed', () => {
    const account = accountCoverage(['a.ts'], [
      verdict({ skipped: [{ path: 'a.ts', reason: 'too big' }] }),
      verdict({ reviewed: ['a.ts'] }),
    ])
    expect(account).toMatchObject({ reviewedFiles: 1, skippedFiles: 0, coverageRate: 100 })
  })

  it('counts a file reviewed then skipped as reviewed', () => {
    const account = accountCoverage(['a.ts'], [
      verdict({ reviewed: ['a.ts'] }),
      verdict({ skipped: [{ path: 'a.ts', reason: 'too big' }] }),
    ])
    expect(account).toMatchObject({ reviewedFiles: 1, skippedFiles: 0, coverageRate: 100 })
  })

  it('reports full coverage for an empty scope rather than dividing by zero', () => {
    expect(accountCoverage([], [])).toMatchObject({ totalFiles: 0, coverageRate: 100 })
  })
})

describe('the veto threshold', () => {
  it.each([
    ['critical', 'high', true],
    ['high', 'high', true],
    ['medium', 'high', false],
    ['low', 'low', true],
    ['medium', 'low', true],
    ['critical', 'critical', true],
    ['high', 'critical', false],
  ] as const)('%s against a floor of %s vetoes: %s', (severity, threshold, expected) => {
    expect(vetoes(severity, threshold)).toBe(expected)
  })

  it.each(['critical', 'high', 'medium', 'low'] as const)('never lets %s veto when the floor is never', (severity) => {
    expect(vetoes(severity, 'never')).toBe(false)
  })
})
