import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  buildGitChangeTree,
  statusKind,
  type GitChangeDirectoryNode,
  type GitChangeFileNode,
  type GitChangeNode,
  type GitSide,
  type GitStatusKind,
} from '../src/client/git-tree.ts'
import type { GitStatusEntry } from '../src/client/api.ts'

function directoryNode(node: GitChangeNode): GitChangeDirectoryNode {
  expect(node.kind).toBe('directory')
  if (node.kind !== 'directory') throw new Error(`expected directory, received ${node.kind}`)
  return node
}

function fileNodes(nodes: readonly GitChangeNode[]): GitChangeFileNode[] {
  return nodes.flatMap(node => node.kind === 'file' ? [node] : fileNodes(node.children))
}

describe('git change tree', () => {
  it('builds deterministic directory-first trees from unordered entries', () => {
    const tree = buildGitChangeTree([
      { path: 'src/api/client.ts', xy: ' M' },
      { path: 'README.md', xy: '??' },
      { path: 'src/index.ts', xy: ' M' },
      { path: 'src/api/types.ts', xy: ' M' },
    ], 'unstaged')

    expect(tree.map(node => node.name)).toEqual(['src', 'README.md'])
    const src = directoryNode(tree[0]!)
    const api = directoryNode(src.children[0]!)
    expect(src.children.map(node => node.name)).toEqual(['api', 'index.ts'])
    expect(api.children.map(node => node.name)).toEqual(['client.ts', 'types.ts'])
    expect(src).toMatchObject({ path: 'src/', count: 3, conflicted: false })
  })

  it('filters each side independently and includes MM on both sides', () => {
    const entries: GitStatusEntry[] = [
      { path: 'staged.ts', xy: 'A ' },
      { path: 'unstaged.ts', xy: ' M' },
      { path: 'both.ts', xy: 'MM' },
      { path: 'new.ts', xy: '??' },
    ]

    expect(fileNodes(buildGitChangeTree(entries, 'staged')).map(node => [node.path, node.status])).toEqual([
      ['both.ts', 'modified'],
      ['staged.ts', 'added'],
    ])
    expect(fileNodes(buildGitChangeTree(entries, 'unstaged')).map(node => [node.path, node.status])).toEqual([
      ['both.ts', 'modified'],
      ['new.ts', 'untracked'],
      ['unstaged.ts', 'modified'],
    ])
  })

  it.each<[GitStatusEntry, GitSide, ReturnType<typeof statusKind>]>([
    [{ path: 'added', xy: 'A ' }, 'staged', 'added'],
    [{ path: 'modified', xy: ' M' }, 'unstaged', 'modified'],
    [{ path: 'deleted', xy: 'D ' }, 'staged', 'deleted'],
    [{ path: 'renamed', xy: 'R ' }, 'staged', 'renamed'],
    [{ path: 'copied', xy: 'C ' }, 'staged', 'copied'],
    [{ path: 'untracked', xy: '??' }, 'unstaged', 'untracked'],
    [{ path: 'conflicted', xy: 'UU' }, 'staged', 'conflicted'],
    [{ path: 'conflicted', xy: 'UD' }, 'unstaged', 'conflicted'],
    [{ path: 'other-side', xy: ' M' }, 'staged', undefined],
    [{ path: 'other-side', xy: 'A ' }, 'unstaged', undefined],
  ])('classifies $0.xy on the $1 side as $2', (entry, side, expected) => {
    expect(statusKind(entry, side)).toBe(expected)
  })

  it('uses rename and copy destination paths as the displayed file paths', () => {
    const rename = { path: 'src/new-name.ts', xy: 'R ' }
    const copy = { path: 'src/copied.ts', xy: 'C ' }
    const files = fileNodes(buildGitChangeTree([copy, rename], 'staged'))

    expect(files.map(node => [node.name, node.path, node.status, node.entry])).toEqual([
      ['copied.ts', 'src/copied.ts', 'copied', copy],
      ['new-name.ts', 'src/new-name.ts', 'renamed', rename],
    ])
  })

  it('normalizes Windows separators and rejects unsafe or ambiguous path segments', () => {
    const entries: GitStatusEntry[] = [
      { path: 'src\\api\\client.ts', xy: ' M' },
      { path: '', xy: ' M' },
      { path: '.', xy: ' M' },
      { path: '..', xy: ' M' },
      { path: '/absolute.ts', xy: ' M' },
      { path: 'src//empty.ts', xy: ' M' },
      { path: 'src/./dot.ts', xy: ' M' },
      { path: 'src/../parent.ts', xy: ' M' },
      { path: 'src/trailing/', xy: ' M' },
    ]

    const tree = buildGitChangeTree(entries, 'unstaged')
    expect(fileNodes(tree).map(node => node.path)).toEqual(['src/api/client.ts'])
    const src = directoryNode(tree[0]!)
    expect(src).toMatchObject({ path: 'src/', count: 1 })
    expect(directoryNode(src.children[0]!)).toMatchObject({ path: 'src/api/', count: 1 })
  })

  it('counts directory descendants and propagates conflict state to every ancestor', () => {
    const tree = buildGitChangeTree([
      { path: 'src/api/client.ts', xy: ' M' },
      { path: 'src/api/conflict.ts', xy: 'UU' },
      { path: 'src/ui/view.tsx', xy: ' M' },
    ], 'unstaged')

    const src = directoryNode(tree[0]!)
    expect(src).toMatchObject({ path: 'src/', count: 3, conflicted: true })
    expect(src.children).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'src/api/', count: 2, conflicted: true }),
      expect.objectContaining({ path: 'src/ui/', count: 1, conflicted: false }),
    ]))
  })

  it('separates a directory identity and descendant actions from a same-path file', () => {
    const tree = buildGitChangeTree([
      { path: 'foo', xy: ' D' },
      { path: 'foo/nested/deep.ts', xy: '??' },
      { path: 'foo/bar.ts', xy: '??' },
    ], 'unstaged')

    expect(tree.map(node => [node.kind, node.path])).toEqual([
      ['directory', 'foo/'],
      ['file', 'foo'],
    ])
    const directory = directoryNode(tree[0]!)
    expect(directory).toMatchObject({
      actionPaths: ['foo/bar.ts', 'foo/nested/deep.ts'],
    })
    expect(directory.actionPaths).not.toContain('foo')
    expect(Object.isFrozen(directory.actionPaths)).toBe(true)
    expect(new Set(tree.map(node => node.path)).size).toBe(2)
  })

  it('retains a deeply immutable copy instead of aliasing the caller entry', () => {
    const entry = {
      path: 'src/client.ts',
      xy: ' M',
      metadata: { labels: ['original'] },
    } as GitStatusEntry & { metadata: { labels: string[] } }

    const node = fileNodes(buildGitChangeTree([entry], 'unstaged'))[0]!
    const retained = node.entry as GitStatusEntry & { metadata: { labels: string[] } }

    expect(retained).not.toBe(entry)
    expect(retained).toEqual(entry)
    expect(Object.isFrozen(retained)).toBe(true)
    expect(Object.isFrozen(retained.metadata)).toBe(true)
    expect(Object.isFrozen(retained.metadata.labels)).toBe(true)

    entry.path = 'changed.ts'
    entry.xy = ' D'
    entry.metadata.labels.push('changed')
    expect(retained).toEqual({
      path: 'src/client.ts',
      xy: ' M',
      metadata: { labels: ['original'] },
    })
  })

  it('exposes exhaustive immutable directory and file variants', () => {
    const tree = buildGitChangeTree([
      { path: 'src/client.ts', xy: ' M' },
      { path: 'README.md', xy: '??' },
    ], 'unstaged')
    const directory = tree[0]!
    const file = tree[1]!
    expect(directory.kind).toBe('directory')
    expect(file.kind).toBe('file')
    if (directory.kind !== 'directory' || file.kind !== 'file') throw new Error('unexpected node order')

    expectTypeOf(directory).toEqualTypeOf<GitChangeDirectoryNode>()
    expectTypeOf(directory.children).toEqualTypeOf<readonly GitChangeNode[]>()
    expectTypeOf(directory.actionPaths).toEqualTypeOf<readonly string[]>()
    // @ts-expect-error Directory nodes cannot expose file payload fields.
    directory.entry
    // @ts-expect-error Directory nodes cannot expose file status fields.
    directory.status

    expectTypeOf(file).toEqualTypeOf<GitChangeFileNode>()
    expectTypeOf(file.count).toEqualTypeOf<1>()
    expectTypeOf(file.status).toEqualTypeOf<GitStatusKind>()
    expectTypeOf(file.entry).toEqualTypeOf<Readonly<GitStatusEntry>>()
    // @ts-expect-error File nodes cannot expose directory children.
    file.children
    // @ts-expect-error File nodes cannot expose directory action paths.
    file.actionPaths

    expect(directory).not.toHaveProperty('entry')
    expect(directory).not.toHaveProperty('status')
    expect(file).not.toHaveProperty('children')
    expect(file).not.toHaveProperty('actionPaths')
    expect(Object.isFrozen(directory.children)).toBe(true)
    expect(Object.isFrozen(directory.actionPaths)).toBe(true)
    expect(Object.isFrozen(file.entry)).toBe(true)
  })

  it('resolves duplicate normalized paths by status severity independent of input order', () => {
    const modified = { path: 'src\\same.ts', xy: ' M' }
    const deleted = { path: 'src/same.ts', xy: ' D' }
    const conflicted = { path: 'src/same.ts', xy: 'UU' }

    for (const entries of [
      [modified, deleted, conflicted],
      [conflicted, modified, deleted],
      [deleted, conflicted, modified],
    ]) {
      const file = fileNodes(buildGitChangeTree(entries, 'unstaged'))[0]
      expect(file).toMatchObject({ path: 'src/same.ts', count: 1, status: 'conflicted', conflicted: true })
      expect(file?.entry).toEqual(conflicted)
      expect(file?.entry).not.toBe(conflicted)
    }
  })
})
