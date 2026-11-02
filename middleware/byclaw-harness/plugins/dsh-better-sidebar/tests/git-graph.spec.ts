import { describe, expect, it } from 'vitest'
import { buildGitGraph } from '../src/client/git-graph.ts'
import type { GitLogEntry } from '../src/client/api.ts'

function entry(hash: string, parents: string[]): GitLogEntry {
  return {
    hash: hash.slice(0, 7),
    hashFull: hash,
    subject: hash,
    author: 'A',
    date: '2026-08-27 00:00:00 +0800',
    refs: '',
    parents,
  }
}

describe('git graph lane layout', () => {
  it('keeps a linear history on one lane', () => {
    const rows = buildGitGraph([
      entry('a', ['b']),
      entry('b', ['c']),
      entry('c', []),
    ])

    expect(rows.map(row => row.nodeLane)).toEqual([0, 0, 0])
    expect(rows[0]!.segments).toEqual([{ from: 0, to: 0, color: 0 }])
    expect(rows[2]!.segments).toEqual([])
  })

  it('draws fork and merge transitions from real parent hashes', () => {
    const rows = buildGitGraph([
      entry('merge', ['left', 'right']),
      entry('left', ['base']),
      entry('right', ['base']),
      entry('base', []),
    ])

    expect(rows[0]).toMatchObject({ nodeLane: 0, maxLane: 2 })
    expect(rows[0]!.segments).toEqual([
      { from: 0, to: 0, color: 0 },
      { from: 0, to: 1, color: 1 },
    ])
    expect(rows[1]).toMatchObject({ nodeLane: 0, maxLane: 2 })
    expect(rows[2]!.nodeLane).toBe(1)
    expect(rows[2]!.segments).toContainEqual({ from: 1, to: 0, color: 0 })
    expect(rows[3]!.nodeLane).toBe(0)
  })

  it('keeps already-rendered lane geometry stable when another page appends', () => {
    const firstPage = [entry('merge', ['left', 'right']), entry('left', ['base'])]
    const complete = [...firstPage, entry('right', ['base']), entry('base', [])]
    expect(buildGitGraph(complete).slice(0, firstPage.length)).toEqual(buildGitGraph(firstPage))
  })
})
