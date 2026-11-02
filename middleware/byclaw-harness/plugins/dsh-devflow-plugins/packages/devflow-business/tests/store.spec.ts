// Discovery and parsing: root derivation that keeps every devflow root under
// one `.devflow/`, the frontmatter split, the confirmed-only-when-it-says-so
// status read, and a malformed file warning without hiding the rest.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { resolveConfig } from '@zhchxiao123/dsh-devflow-business'
import {
  BUSINESS_BUCKETS,
  citationsOf,
  isBucket,
  loadDocs,
  loadSources,
  parseBusinessFile,
  parseList,
  renderDoc,
  validateDocId,
  workspaceOf,
} from '../src/store.ts'

let root: string | undefined

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

function agentIn(cwd?: string): Agent {
  return { session: { header: cwd === undefined ? {} : { cwd } } } as unknown as Agent
}

async function seed(files: Record<string, string>): Promise<string> {
  root = await mkdtemp(join(tmpdir(), 'devflow-business-store-'))
  const businessDir = join(root, '.devflow', 'business')
  for (const [relative, content] of Object.entries(files)) {
    const path = join(businessDir, relative)
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, content)
  }
  return businessDir
}

function doc(fields: Record<string, string>, body: string): string {
  return `---\n${Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join('\n')}\n---\n\n${body}\n`
}

describe('workspaceOf', () => {
  it('puts business knowledge under the session cwd, beside cards and spec', () => {
    const workspace = workspaceOf(agentIn('/tmp/project'), resolveConfig({}))

    expect(workspace.businessDir).toBe(join(resolve('/tmp/project'), '.devflow', 'business'))
    expect(workspace.projectRoot).toBe(resolve('/tmp/project'))
  })

  it('falls back to the configured root for a session carrying no cwd', () => {
    const workspace = workspaceOf(agentIn(), resolveConfig({ root: 'knowledge/base' }))

    expect(workspace.businessDir).toBe(resolve('knowledge/base'))
  })
})

describe('validateDocId', () => {
  it('rejects anything that would escape or reshape a path', () => {
    expect(validateDocId('order-object')).toBeUndefined()
    expect(validateDocId('a1')).toBeUndefined()
    expect(validateDocId('../escape')).toContain('invalid document id')
    expect(validateDocId('a/b')).toContain('invalid document id')
    expect(validateDocId('/absolute')).toContain('invalid document id')
    expect(validateDocId('Order')).toContain('invalid document id')
    expect(validateDocId('-leading')).toContain('invalid document id')
    expect(validateDocId('')).toContain('invalid document id')
  })
})

describe('isBucket', () => {
  it('narrows exactly the closed set', () => {
    for (const bucket of BUSINESS_BUCKETS) expect(isBucket(bucket)).toBe(true)
    expect(isBucket('glossary')).toBe(false)
  })
})

describe('parseBusinessFile', () => {
  it('splits a flat frontmatter block, keeping colons in values', () => {
    const parsed = parseBusinessFile('---\ntitle: Order: the trading one\nstatus: confirmed\n---\n\nBody text.\n')

    expect(parsed.frontmatter.title).toBe('Order: the trading one')
    expect(parsed.frontmatter.status).toBe('confirmed')
    expect(parsed.body).toBe('Body text.')
  })

  it('strips matching quotes and skips comments and blank keys', () => {
    const parsed = parseBusinessFile('---\n# a comment\ntitle: "Quoted"\n: nokey\n---\n\nBody.\n')

    expect(parsed.frontmatter.title).toBe('Quoted')
    expect(Object.keys(parsed.frontmatter)).toEqual(['title'])
  })

  it('treats a file with no fence as all body', () => {
    const parsed = parseBusinessFile('Just prose.\n')

    expect(parsed.frontmatter).toEqual({})
    expect(parsed.body).toBe('Just prose.')
  })
})

describe('parseList', () => {
  it('distinguishes "declared none" from "declared an empty set"', () => {
    expect(parseList(undefined)).toBeUndefined()
    expect(parseList('   ')).toBeUndefined()
    expect(parseList('a b')).toEqual(['a', 'b'])
    expect(parseList('a, b')).toEqual(['a', 'b'])
  })
})

describe('citationsOf', () => {
  it('collects ids in first-appearance order without repeats', () => {
    expect(citationsOf('See [[b]] and [[a]], then [[b]] again.')).toEqual(['b', 'a'])
    expect(citationsOf('No citations here.')).toEqual([])
    expect(citationsOf('[[Bad-Case]] is not an id.')).toEqual([])
  })
})

describe('loadSources', () => {
  it('reads both manifest entry forms and treats a missing manifest as empty', async () => {
    const businessDir = await seed({
      'source-manifest.yaml': 'sources:\n  - id: proposal-2026-01\n    kind: proposal\n  - id: "incident-0417"\n  walkthrough-q1:\n',
    })

    expect(await loadSources(businessDir)).toEqual(['proposal-2026-01', 'incident-0417', 'walkthrough-q1'])
    expect(await loadSources(join(businessDir, 'nowhere'))).toEqual([])
  })

  it('does not register the container key as a source', async () => {
    // A registry that admits its own header admits anything: `sources` would
    // become a citable id and every unregistered claim could name it.
    const businessDir = await seed({ 'source-manifest.yaml': 'sources:\n  - id: real-one\n' })

    expect(await loadSources(businessDir)).not.toContain('sources')
  })
})

describe('loadDocs', () => {
  it('is inert in a workspace with no business directory', async () => {
    root = await mkdtemp(join(tmpdir(), 'devflow-business-empty-'))

    const set = await loadDocs(workspaceOf(agentIn(root), resolveConfig({})))

    expect(set.docs).toEqual([])
    expect(set.sources).toEqual([])
    expect(set.warnings).toEqual([])
  })

  it('confirms only on the literal word, so an unreadable state stays pending', async () => {
    const businessDir = await seed({
      'source-manifest.yaml': 'sources:\n  - id: s1\n',
      'meta/a.md': doc({ title: 'A', sources: 's1', status: 'confirmed' }, 'Body.'),
      'meta/b.md': doc({ title: 'B', sources: 's1', status: 'Confirmed' }, 'Body.'),
      'meta/c.md': doc({ title: 'C', sources: 's1' }, 'Body.'),
    })

    const { docs } = await loadDocs({ projectRoot: join(businessDir, '..', '..'), businessDir })

    expect(docs.map(entry => [entry.id, entry.status])).toEqual([['a', 'confirmed'], ['b', 'pending-review'], ['c', 'pending-review']])
  })

  it('warns past a malformed file instead of hiding the rest', async () => {
    const businessDir = await seed({
      'source-manifest.yaml': 'sources:\n  - id: s1\n',
      'meta/good.md': doc({ title: 'Good', sources: 's1' }, 'Body.'),
      'meta/no-title.md': doc({ sources: 's1' }, 'Body.'),
      'meta/no-sources.md': doc({ title: 'Untraceable' }, 'Body.'),
      'meta/index.md': '# Navigation\n',
      'meta/Bad-Id.md': doc({ title: 'Bad', sources: 's1' }, 'Body.'),
    })

    const { docs, warnings } = await loadDocs({ projectRoot: businessDir, businessDir })

    expect(docs.map(entry => entry.id)).toEqual(['good'])
    expect(warnings.join('\n')).toContain('no "title"')
    expect(warnings.join('\n')).toContain('no "sources"')
    expect(warnings.join('\n')).toContain('invalid document id')
  })

  it('corrects a frontmatter id that disagrees with the filename', async () => {
    const businessDir = await seed({
      'source-manifest.yaml': 'sources:\n  - id: s1\n',
      'meta/actual.md': doc({ id: 'claimed', title: 'A', sources: 's1' }, 'Body.'),
    })

    const { docs, warnings } = await loadDocs({ projectRoot: businessDir, businessDir })

    expect(docs[0]?.id).toBe('actual')
    expect(warnings.join('\n')).toContain('using the filename')
  })

  it('orders by bucket reading order, then by id', async () => {
    const businessDir = await seed({
      'source-manifest.yaml': 'sources:\n  - id: s1\n',
      'reference/z.md': doc({ title: 'Z', sources: 's1' }, 'Body.'),
      'meta/b.md': doc({ title: 'B', sources: 's1' }, 'Body.'),
      'meta/a.md': doc({ title: 'A', sources: 's1' }, 'Body.'),
      'scenario/s.md': doc({ title: 'S', sources: 's1' }, 'Body.'),
    })

    const { docs } = await loadDocs({ projectRoot: businessDir, businessDir })

    expect(docs.map(entry => `${entry.bucket}/${entry.id}`)).toEqual(['meta/a', 'meta/b', 'scenario/s', 'reference/z'])
  })

  it('carries lastConfirmed and watches through when declared', async () => {
    const businessDir = await seed({
      'source-manifest.yaml': 'sources:\n  - id: s1\n',
      'scenario/query.md': doc(
        { title: 'Q', sources: 's1', scope: 'v2 only', lastConfirmed: '2026-03-01', watches: 'services/a/ services/b/' },
        'Cites [[nothing]].',
      ),
    })

    const { docs } = await loadDocs({ projectRoot: businessDir, businessDir })

    expect(docs[0]?.lastConfirmed).toBe('2026-03-01')
    expect(docs[0]?.watches).toEqual(['services/a/', 'services/b/'])
    expect(docs[0]?.scope).toBe('v2 only')
    expect(docs[0]?.cites).toEqual(['nothing'])
  })
})

describe('renderDoc', () => {
  it('has no way to emit anything but pending-review', () => {
    const text = renderDoc({ id: 'a', bucket: 'meta', title: 'A', scope: 'all', sources: ['s1'], body: 'Body.' })

    expect(text).toContain('status: pending-review')
    expect(text).not.toContain('watches:')
    expect(text.endsWith('Body.\n')).toBe(true)
  })

  it('emits watches only when the document declares some', () => {
    const text = renderDoc({ id: 'a', bucket: 'scenario', title: 'A', scope: 'all', sources: ['s1'], body: 'B.', watches: ['src/'] })

    expect(text).toContain('watches: src/')
  })
})
