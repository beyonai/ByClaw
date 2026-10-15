import type { GitStatusEntry } from './api.ts'

/** The porcelain column represented by one source-control section. */
export type GitSide = 'staged' | 'unstaged'

/** Semantic status used by tree rendering independently of porcelain letters. */
export type GitStatusKind =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'conflicted'

/** One immutable directory in a repository-relative change tree. */
export interface GitChangeDirectoryNode {
  kind: 'directory'
  name: string
  /** Stable UI identity; directory paths end in `/` and are not Git pathspecs. */
  path: string
  count: number
  children: readonly GitChangeNode[]
  /** Exact changed-file paths affected by this directory subtree action. */
  actionPaths: readonly string[]
  conflicted: boolean
}

/** One immutable changed file in a repository-relative change tree. */
export interface GitChangeFileNode {
  kind: 'file'
  name: string
  path: string
  count: 1
  status: GitStatusKind
  entry: Readonly<GitStatusEntry>
  conflicted: boolean
}

/** An exhaustive directory or file node in a repository-relative change tree. */
export type GitChangeNode = GitChangeDirectoryNode | GitChangeFileNode

const CONFLICT_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])

/** Classify the change carried by one side of a porcelain XY status. */
export function statusKind(entry: GitStatusEntry, side: GitSide): GitStatusKind | undefined {
  if (CONFLICT_CODES.has(entry.xy)) return 'conflicted'
  if (entry.xy === '??') return side === 'unstaged' ? 'untracked' : undefined

  const code = entry.xy[side === 'staged' ? 0 : 1]
  if (code === undefined || code === ' ' || code === '?' || code === '!') return undefined
  switch (code) {
    case 'A': return 'added'
    case 'D': return 'deleted'
    case 'R': return 'renamed'
    case 'C': return 'copied'
    case 'M':
    case 'T': return 'modified'
    case 'U': return 'conflicted'
    default: return undefined
  }
}

interface TrieFile {
  entry: GitStatusEntry
  status: GitStatusKind
}

interface TrieDirectory {
  directories: Map<string, TrieDirectory>
  files: Map<string, TrieFile>
}

const STATUS_SEVERITY: Record<GitStatusKind, number> = {
  untracked: 0,
  modified: 1,
  added: 2,
  copied: 3,
  renamed: 4,
  deleted: 5,
  conflicted: 6,
}

function normalizedSegments(path: string): string[] | undefined {
  const segments = path.replaceAll('\\', '/').split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) return undefined
  return segments
}

/** Recursively detach and freeze JSON data received from the host API. */
function immutableWireClone<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(item => immutableWireClone(item))) as T
  }
  if (value !== null && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, immutableWireClone(item)]),
    )) as T
  }
  return value
}

function compareNames(left: string, right: string): number {
  const localized = left.localeCompare(right)
  if (localized !== 0) return localized
  if (left === right) return 0
  return left < right ? -1 : 1
}

function preferredFile(left: TrieFile, right: TrieFile): TrieFile {
  const severity = STATUS_SEVERITY[left.status] - STATUS_SEVERITY[right.status]
  if (severity !== 0) return severity > 0 ? left : right
  const xy = compareNames(left.entry.xy, right.entry.xy)
  if (xy !== 0) return xy < 0 ? left : right
  return compareNames(left.entry.path, right.entry.path) <= 0 ? left : right
}

function descendantActionPaths(nodes: readonly GitChangeNode[]): string[] {
  return nodes
    .flatMap(node => node.kind === 'file'
      ? [node.entry.path]
      : node.actionPaths)
    .sort(compareNames)
}

function emitDirectory(directory: TrieDirectory, prefix: string): GitChangeNode[] {
  const directories = [...directory.directories.entries()]
    .sort(([left], [right]) => compareNames(left, right))
    .map(([name, child]) => {
      const path = prefix === '' ? name : `${prefix}/${name}`
      const children = emitDirectory(child, path)
      const node: GitChangeDirectoryNode = {
        kind: 'directory',
        name,
        path: `${path}/`,
        count: children.reduce((total, descendant) => total + descendant.count, 0),
        children,
        actionPaths: descendantActionPaths(children),
        conflicted: children.some(descendant => descendant.conflicted),
      }
      Object.freeze(children)
      Object.freeze(node.actionPaths)
      return Object.freeze(node)
    })

  const files = [...directory.files.entries()]
    .sort(([left], [right]) => compareNames(left, right))
    .map(([name, file]) => {
      const node: GitChangeFileNode = {
        kind: 'file',
        name,
        path: prefix === '' ? name : `${prefix}/${name}`,
        count: 1,
        status: file.status,
        entry: file.entry,
        conflicted: file.status === 'conflicted',
      }
      return Object.freeze(node)
    })

  return [...directories, ...files]
}

/** Build a deterministic directory-first tree for one porcelain status side. */
export function buildGitChangeTree(entries: readonly GitStatusEntry[], side: GitSide): GitChangeNode[] {
  const root: TrieDirectory = { directories: new Map(), files: new Map() }

  for (const entry of entries) {
    const status = statusKind(entry, side)
    if (status === undefined) continue
    const segments = normalizedSegments(entry.path)
    if (segments === undefined) continue

    let directory = root
    for (const segment of segments.slice(0, -1)) {
      let child = directory.directories.get(segment)
      if (child === undefined) {
        child = { directories: new Map(), files: new Map() }
        directory.directories.set(segment, child)
      }
      directory = child
    }

    const name = segments.at(-1)!
    const next = { entry: immutableWireClone(entry), status }
    const previous = directory.files.get(name)
    directory.files.set(name, previous === undefined ? next : preferredFile(previous, next))
  }

  const tree = emitDirectory(root, '')
  Object.freeze(tree)
  return tree
}
