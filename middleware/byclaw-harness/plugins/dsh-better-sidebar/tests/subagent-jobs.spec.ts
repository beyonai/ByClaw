/**
 * Pure-helper tests for the Subagent page's background-job section:
 * tree-membership collection, ordering, and status presentation mapping.
 */
import { describe, expect, it } from 'vitest'
import {
  collectTreeJobs,
  detectNewJob,
  formatJobDuration,
  isJobLive,
  orderJobs,
  jobDotState,
  jobStatusLabel,
  treeSessionIds,
} from '../src/client/subagent-jobs.ts'
import type { SidebarSessionList, SidebarSessionSummary, SidebarJobStatus, SidebarJobView } from '../src/context-types.ts'

/** The translator stub: renders duration templates like the real locale copy. */
const templates: Record<string, string> = {
  jobDurationSeconds: '{seconds}秒',
  jobDurationMinutes: '{minutes}分{seconds}秒',
  jobDurationHours: '{hours}小时{minutes}分',
}
const t = (key: string, params?: Record<string, string | number>): string => {
  let text = templates[key] ?? key
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
}

function summary(id: string, over: Partial<SidebarSessionSummary> = {}): SidebarSessionSummary {
  return { id, displayTitle: `title-${id}`, ...over }
}

function job(id: string, over: Partial<SidebarJobView> = {}): SidebarJobView {
  return { id, kind: 'bash', label: `cmd ${id}`, status: 'running', startedAt: 1_000, ...over }
}

describe('treeSessionIds', () => {
  it('includes the root and every subagent-origin session whose chain reaches it', () => {
    const byId = {
      root: summary('root'),
      child: summary('child', { origin: 'subagent', parentId: 'root' }),
      grand: summary('grand', { origin: 'subagent', parentId: 'child' }),
      orphan: summary('orphan', { origin: 'subagent', parentId: 'gone' }),
      other: summary('other', { origin: 'subagent', parentId: 'other-root' }),
    }
    const ids = treeSessionIds(byId, 'root')
    expect([...ids].sort()).toEqual(['child', 'grand', 'root'])
  })

  it('fails soft on parent cycles and yields nothing without a root', () => {
    const byId = {
      root: summary('root'),
      a: summary('a', { origin: 'subagent', parentId: 'b' }),
      b: summary('b', { origin: 'subagent', parentId: 'a' }),
    }
    expect(treeSessionIds(byId, 'root').size).toBe(1)
    expect(treeSessionIds(byId, undefined).size).toBe(0)
  })
})

describe('collectTreeJobs', () => {
  it('collects jobs of the whole tree with owner titles, ignoring outside sessions', () => {
    const byId = {
      root: summary('root'),
      child: summary('child', { origin: 'subagent', parentId: 'root' }),
    }
    const jobsBySession = {
      root: [job('bash-1')],
      child: [job('bash-2', { status: 'completed', finishedAt: 2_000 })],
      stranger: [job('bash-9')],
    }
    const rows = collectTreeJobs(byId, jobsBySession, 'root')
    expect(rows.map(row => [row.ownerSessionId, row.ownerTitle, row.job.id]))
      .toEqual([['root', 'title-root', 'bash-1'], ['child', 'title-child', 'bash-2']])
  })

  it('returns an empty list for an absent mirror or empty sets', () => {
    const byId = { root: summary('root') }
    expect(collectTreeJobs(byId, undefined, 'root')).toEqual([])
    expect(collectTreeJobs(byId, {}, 'root')).toEqual([])
  })
})

describe('orderJobs', () => {
  it('puts live rows first in start order, then settled rows newest-first', () => {
    const row = (id: string, status: SidebarJobStatus, startedAt: number, finishedAt?: number) => ({
      ownerSessionId: 'root',
      ownerTitle: 'root',
      job: job(id, { status, startedAt, ...(finishedAt !== undefined ? { finishedAt } : {}) }),
    })
    const rows = [
      row('old-settled', 'completed', 1_000, 2_000),
      row('live-2', 'running', 4_000),
      row('new-settled', 'killed', 1_500, 1_800),
      row('live-1', 'stopping', 3_000),
    ]
    expect(orderJobs(rows).map(r => r.job.id)).toEqual(['live-1', 'live-2', 'old-settled', 'new-settled'])
  })
})

describe('status presentation helpers', () => {
  it('treats running and stopping as live', () => {
    expect(isJobLive(job('a', { status: 'running' }))).toBe(true)
    expect(isJobLive(job('b', { status: 'stopping' }))).toBe(true)
    expect(isJobLive(job('c', { status: 'completed' }))).toBe(false)
    expect(isJobLive(job('d', { status: 'killed' }))).toBe(false)
    expect(isJobLive(job('e', { status: 'failed' }))).toBe(false)
  })

  it('maps the five wire statuses to dot states and localized labels', () => {
    expect(jobDotState('running')).toBe('ongoing')
    expect(jobDotState('stopping')).toBe('warning')
    expect(jobDotState('completed')).toBe('done')
    expect(jobDotState('killed')).toBe('warning')
    expect(jobDotState('failed')).toBe('error')
    expect(jobStatusLabel('running', t)).toBe('jobStatusRunning')
    expect(jobStatusLabel('stopping', t)).toBe('jobStatusStopping')
    expect(jobStatusLabel('completed', t)).toBe('jobStatusCompleted')
    expect(jobStatusLabel('killed', t)).toBe('jobStatusKilled')
    expect(jobStatusLabel('failed', t)).toBe('jobStatusFailed')
  })

  it('formats durations in at most two adjacent units', () => {
    expect(formatJobDuration(0, t)).toBe('0秒')
    expect(formatJobDuration(45_000, t)).toBe('45秒')
    expect(formatJobDuration(90_000, t)).toBe('1分30秒')
    expect(formatJobDuration(3_661_000, t)).toBe('1小时1分')
    // Negative or fractional input clamps to zero seconds.
    expect(formatJobDuration(-5, t)).toBe('0秒')
  })
})

describe('detectNewJob', () => {
  const list = (jobsBySession: Record<string, SidebarJobView[]>): SidebarSessionList => ({
    current: 'root',
    byId: { root: { id: 'root', displayTitle: 'root' } },
    subagentsByParent: {},
    jobsBySession: jobsBySession,
  })

  it('fires on EVERY new job id for the session (not just the first)', () => {
    expect(detectNewJob(list({}), list({ root: [job('bash-1')] }), 'root')).toBe(true)
    expect(detectNewJob(
      list({ root: [job('bash-1')] }),
      list({ root: [job('bash-1'), job('bash-2')] }),
      'root',
    )).toBe(true)
  })

  it('stays quiet on settling, same ids, other sessions, or an absent mirror', () => {
    // Settling only mutates status, never adds ids.
    expect(detectNewJob(
      list({ root: [job('bash-1')] }),
      list({ root: [job('bash-1', { status: 'completed', finishedAt: 2_000 })] }),
      'root',
    )).toBe(false)
    expect(detectNewJob(list({ root: [job('bash-1')] }), list({ root: [job('bash-1')] }), 'root')).toBe(false)
    // Jobs owned by another session do not trigger the current one.
    expect(detectNewJob(list({}), list({ child: [job('bash-1')] }), 'root')).toBe(false)
    expect(detectNewJob(list({}), list({}), 'root')).toBe(false)
  })
})
