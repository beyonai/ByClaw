// The written record. A card carries no git identity of its own, so the
// report's frontmatter is the only thing that says afterwards which range was
// reviewed and how much of it was covered — these cases hold that account to
// its shape.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderReport, reportFileName, writeReport } from '@zhchxiao123/dsh-devflow-review-gate/src/report.ts'
import type { ReviewReport } from '@zhchxiao123/dsh-devflow-review-gate/src/report.ts'
import { ReviewError } from '@zhchxiao123/dsh-devflow-review-gate/src/ocr.ts'
import type { ReviewComment } from '@zhchxiao123/dsh-devflow-review-gate/src/types.ts'

function report(over: Partial<ReviewReport> = {}): ReviewReport {
  return {
    card: '0042-retry-backoff',
    edge: 'developing->reviewing',
    revision: 4,
    kind: 'review-report',
    verdict: 'allow',
    preview: {
      mode: 'workspace',
      repository: '/work',
      reviewable: [{ path: 'a.ts', status: 'modified', insertions: 2, deletions: 1 }],
      excluded: [],
    },
    coverage: { totalFiles: 1, reviewedFiles: 1, skippedFiles: 0, coverageRate: 100, skipped: [] },
    comments: [],
    ...over,
  }
}

const COMMENT = (over: Partial<ReviewComment> = {}): ReviewComment =>
  ({ path: 'a.ts', content: 'null dereference', severity: 'high', ...over })

describe('the report file name', () => {
  it('is unique per card, edge, and revision', () => {
    expect(reportFileName('0042-a', 'developing->reviewing', 7))
      .toBe('0042-a-developing-reviewing-r7.md')
  })
})

describe('the scope account', () => {
  it('states workspace mode with no refs to state', () => {
    const rendered = renderReport(report())
    expect(rendered).toContain('mode: workspace')
    expect(rendered).not.toContain('base_ref:')
    expect(rendered).not.toContain('merge_base:')
    expect(rendered).not.toContain('head:')
  })

  it('states every ref a range review was taken against', () => {
    const rendered = renderReport(report({
      baseRef: 'main',
      head: 'f'.repeat(40),
      preview: { ...report().preview, mode: 'range', mergeBase: 'a'.repeat(40) },
    }))
    expect(rendered).toContain('base_ref: main')
    expect(rendered).toContain(`merge_base: ${'a'.repeat(40)}`)
    expect(rendered).toContain(`head: ${'f'.repeat(40)}`)
  })

  it('lists what the CLI excluded, and why', () => {
    const rendered = renderReport(report({
      preview: {
        ...report().preview,
        excluded: [{ path: 'notes.md', status: 'added', insertions: 1, deletions: 0, excludeReason: 'unsupported_ext' }],
      },
    }))
    expect(rendered).toContain('Excluded by the CLI:')
    expect(rendered).toContain('- `notes.md` — unsupported_ext')
  })

  it('says nothing about exclusions when there were none', () => {
    expect(renderReport(report())).not.toContain('Excluded by the CLI:')
  })
})

describe('the coverage section', () => {
  it('says so plainly when every file was reviewed', () => {
    expect(renderReport(report())).toContain('None — every file in scope was reviewed.')
  })

  it('names each skipped file with the reason the checker gave', () => {
    const rendered = renderReport(report({
      coverage: {
        totalFiles: 2, reviewedFiles: 1, skippedFiles: 1, coverageRate: 50,
        skipped: [{ path: 'big.bin', reason: 'binary' }],
      },
    }))
    expect(rendered).toContain('coverage_rate: 50%')
    expect(rendered).toContain('- `big.bin` — binary')
  })
})

describe('the findings section', () => {
  it('says None when the review was clean', () => {
    const rendered = renderReport(report())
    expect(rendered).toContain('findings: 0')
    expect(rendered).toContain('None.')
    expect(rendered).toContain('reported no findings')
  })

  it('groups findings by severity, most severe first', () => {
    const rendered = renderReport(report({
      verdict: 'veto',
      comments: [COMMENT({ severity: 'low' }), COMMENT({ severity: 'critical' }), COMMENT({ severity: 'low' })],
    }))
    expect(rendered.indexOf('### critical')).toBeLessThan(rendered.indexOf('### low'))
    expect(rendered).toContain('1 critical, 2 low')
    expect(rendered).toContain('The move was refused.')
  })

  it('places a finding at its line', () => {
    expect(renderReport(report({ comments: [COMMENT({ startLine: 12 })] })))
      .toContain('- **`a.ts:12`** — null dereference')
  })

  it('places a finding across its range', () => {
    expect(renderReport(report({ comments: [COMMENT({ startLine: 12, endLine: 14 })] })))
      .toContain('`a.ts:12-14`')
  })

  it('does not repeat the line when the range is one line', () => {
    expect(renderReport(report({ comments: [COMMENT({ startLine: 12, endLine: 12 })] })))
      .toContain('`a.ts:12`')
  })

  it('marks a finding the checker could not place', () => {
    expect(renderReport(report({ comments: [COMMENT()] })))
      .toContain('- **`a.ts` (unplaced)** — null dereference')
  })

  it('carries the category when the checker gave one', () => {
    expect(renderReport(report({ comments: [COMMENT({ startLine: 3, category: 'security' })] })))
      .toContain('**`a.ts:3`** [security] — null dereference')
  })
})

describe('writing the report', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-devflow-ocr-report-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('creates the directory it was given', async () => {
    const target = join(dir, 'nested', 'reports')
    const path = await writeReport(target, report())
    expect(await readFile(path, 'utf8')).toContain('card: 0042-retry-backoff')
  })

  // The report is the rework input a veto points at, so losing it would leave
  // the review unauditable in exactly the case that matters.
  it('faults when the directory cannot be created', async () => {
    const blocked = join(dir, 'not-a-directory')
    await writeFile(blocked, 'in the way\n')
    await expect(writeReport(blocked, report())).rejects.toThrow(ReviewError)
    await expect(writeReport(blocked, report())).rejects.toThrow('could not be written')
  })
})
