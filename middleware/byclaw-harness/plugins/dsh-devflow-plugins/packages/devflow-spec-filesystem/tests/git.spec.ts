// The git lookups behind churn anchors, against a real work tree. Absence of
// git must surface as absence — the caller turns that into `unevaluable`, and
// a lookup that quietly answered would make churn anchors permanently green.
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLastCommitAt, isGitRepository } from '@zhchxiao123/dsh-devflow-spec-filesystem'

const run = promisify(execFile)

let repoRoot: string
let plainDir: string

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'spec-git-'))
  plainDir = await mkdtemp(join(tmpdir(), 'spec-plain-'))
  await run('git', ['init', '-q'], { cwd: repoRoot })
  await writeFile(join(repoRoot, 'tracked.ts'), 'export const a = 1\n', 'utf8')
  await run('git', ['add', 'tracked.ts'], { cwd: repoRoot })
  await run('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'add'], { cwd: repoRoot })
})

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true })
  await rm(plainDir, { recursive: true, force: true })
})

describe('isGitRepository', () => {
  it('answers for a work tree', async () => {
    await expect(isGitRepository(repoRoot)).resolves.toBe(true)
  })

  it('answers false outside one rather than throwing', async () => {
    await expect(isGitRepository(plainDir)).resolves.toBe(false)
  })
})

describe('createLastCommitAt', () => {
  it('reports a tracked file\'s last commit as an ISO string', async () => {
    const committedAt = await createLastCommitAt(repoRoot)('tracked.ts')
    expect(committedAt).toBeDefined()
    expect(Number.isNaN(Date.parse(committedAt as string))).toBe(false)
  })

  it('reports undefined for an untracked path', async () => {
    await expect(createLastCommitAt(repoRoot)('never-added.ts')).resolves.toBeUndefined()
  })
})
