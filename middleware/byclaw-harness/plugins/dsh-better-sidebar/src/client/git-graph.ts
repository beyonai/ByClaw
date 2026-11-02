import type { GitLogEntry } from './api.ts'

/** One line segment crossing a commit row between lane centers. */
export interface GitGraphSegment {
  from: number
  to: number
  color: number
}

/** Deterministic graph geometry for one ordered log entry. */
export interface GitGraphRow {
  nodeLane: number
  nodeColor: number
  segments: GitGraphSegment[]
  maxLane: number
}

/**
 * Lay out topologically ordered commits as IDEA-style lanes.
 *
 * Existing lane hashes continue vertically. The displayed commit consumes
 * its lane; its first parent inherits that lane/color, and additional merge
 * parents occupy adjacent lanes with new colors. Recomputing an accumulated
 * page produces the same prefix geometry as the page before it was extended.
 */
export function buildGitGraph(entries: ReadonlyArray<GitLogEntry>): GitGraphRow[] {
  let lanes: string[] = []
  let nextColor = 0
  const colors = new Map<string, number>()
  const colorOf = (hash: string, inherited?: number): number => {
    const existing = colors.get(hash)
    if (existing !== undefined) return existing
    const color = inherited ?? nextColor++ % 8
    colors.set(hash, color)
    return color
  }

  return entries.map((entry) => {
    let nodeLane = lanes.indexOf(entry.hashFull)
    if (nodeLane < 0) {
      nodeLane = lanes.length
      lanes = [...lanes, entry.hashFull]
    }
    const nodeColor = colorOf(entry.hashFull)
    const before = [...lanes]
    const after = [...before]
    after.splice(nodeLane, 1)

    let insertion = nodeLane
    entry.parents.forEach((parent, index) => {
      colorOf(parent, index === 0 ? nodeColor : undefined)
      if (!after.includes(parent)) {
        after.splice(Math.min(insertion, after.length), 0, parent)
        insertion += 1
      }
    })

    const segments: GitGraphSegment[] = []
    before.forEach((hash, lane) => {
      if (hash === entry.hashFull) return
      const target = after.indexOf(hash)
      if (target >= 0) segments.push({ from: lane, to: target, color: colorOf(hash) })
    })
    for (const parent of entry.parents) {
      const target = after.indexOf(parent)
      if (target >= 0) segments.push({ from: nodeLane, to: target, color: colorOf(parent) })
    }

    lanes = after
    return {
      nodeLane,
      nodeColor,
      segments,
      maxLane: Math.max(before.length, after.length, 1),
    }
  })
}
