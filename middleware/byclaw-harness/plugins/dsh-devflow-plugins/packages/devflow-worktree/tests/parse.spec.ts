// The dispatch record's defining grammar: what parses, what is tolerated,
// and every shape that is a malformed dispatch rather than a lenient guess.
import { describe, expect, it } from 'vitest'
import { parseWorktreeDispatch } from '@zhchxiao123/dsh-devflow-worktree'

const VALID = '---\nbranch: devflow/0001-a\nbase: main\nworktree: /repos/wt\n---\nProse.\n'

describe('parseWorktreeDispatch', () => {
  it('reads the three fields from a frontmatter block', () => {
    expect(parseWorktreeDispatch(VALID))
      .toEqual({ branch: 'devflow/0001-a', base: 'main', worktree: '/repos/wt' })
  })

  it('tolerates CRLF, blank lines, and annotation fields a deployment adds', () => {
    const annotated = '---\r\nbranch: b\r\n\r\nbase: main\r\nworktree: /w\r\nnote: extra\r\n---\r\n'
    expect(parseWorktreeDispatch(annotated)).toEqual({ branch: 'b', base: 'main', worktree: '/w' })
  })

  it('keeps a value\'s own colons, as in a path with a drive letter', () => {
    expect(parseWorktreeDispatch('---\nbranch: b\nbase: main\nworktree: C:/repos/wt\n---\n')?.worktree)
      .toBe('C:/repos/wt')
  })

  it.each([
    ['content with no frontmatter', 'branch: b\nbase: main\nworktree: /w\n'],
    ['an unterminated block', '---\nbranch: b\nbase: main\nworktree: /w\n'],
    ['a line that is not a key: value pair', '---\nbranch: b\njust prose\nworktree: /w\n---\n'],
    ['a missing required field', '---\nbranch: b\nbase: main\n---\n'],
    ['a blank required field', '---\nbranch: b\nbase: main\nworktree:\n---\n'],
  ])('rejects %s', (_shape, content) => {
    expect(parseWorktreeDispatch(content)).toBeUndefined()
  })
})
