// Read-side provider behavior against real fixture directories: journal replay
// is the authority, structural violations fail loudly with file and line, a
// drifted frontmatter projection warns and is overridden, and the service
// unregisters with its fiber.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { DevflowCardId } from '@zhchxiao123/dsh-devflow'
import FilesystemDevflowStore from '@zhchxiao123/dsh-devflow-filesystem'
import { injectFsAccessDenied, resetFsFaults, runWithFsFault } from '../../../tests/fs-fault'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile: (...args: Parameters<typeof actual.readFile>) => runWithFsFault('readFile', args[0], () => actual.readFile(...args)),
    readdir: (...args: Parameters<typeof actual.readdir>) => runWithFsFault('readdir', args[0], () => actual.readdir(...args)),
  }
})

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  resetFsFaults()
})

const JOURNAL_TO_DESIGNING = [
  '{"rev":1,"at":"t1","type":"created","by":{"kind":"human","name":"dev"}}',
  '{"rev":2,"at":"t2","type":"transition","from":"draft","to":"designing","by":{"kind":"agent","session":"s1"}}',
  '{"rev":3,"at":"t3","type":"artifact","path":"artifacts/design.md","stage":"designing"}',
].join('\n') + '\n'

function card(frontmatter: string, body = '## Requirement\nDo the thing.\n'): string {
  return `---\n${frontmatter}\n---\n\n${body}`
}

async function writeCard(id: string, files: { card?: string; journal?: string }): Promise<void> {
  const dir = join(root!, 'tasks', id)
  await mkdir(dir, { recursive: true })
  if (files.card !== undefined) await writeFile(join(dir, 'card.md'), files.card)
  if (files.journal !== undefined) await writeFile(join(dir, 'journal.jsonl'), files.journal)
}

async function boot(): Promise<FilesystemDevflowStore> {
  root ??= await mkdtemp(join(tmpdir(), 'dsh-devflow-fs-'))
  const ctx = new Context()
  context = ctx
  await ctx.plugin(FilesystemDevflowStore, { root }).await()
  return ctx.get('devflow') as FilesystemDevflowStore
}

describe('FilesystemDevflowStore reads', () => {
  it('derives current state from the journal and lists cards ordered by id', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-fs-'))
    await writeCard('0002-second', {
      card: card('title: Second card\nstage: designing\nstageRevision: 3'),
      journal: JOURNAL_TO_DESIGNING,
    })
    await writeCard('0001-first', {
      card: card('title: First card\nstage: draft\nstageRevision: 1'),
      journal: '{"rev":1,"at":"t1","type":"created","by":{"kind":"human"}}\n',
    })
    const store = await boot()
    const cards = await store.list()
    expect(cards.map(c => c.id)).toEqual(['0001-first', '0002-second'])
    expect(cards[1]).toMatchObject({
      title: 'Second card',
      stage: 'designing',
      stageRevision: 3,
      artifacts: ['artifacts/design.md'],
    })
    expect(cards[1].body).toContain('Do the thing.')
    expect(cards[1].path.endsWith(join('0002-second', 'card.md'))).toBe(true)
  })

  it('filters by current location and reads a single card', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-fs-'))
    await writeCard('0001-first', {
      card: card('title: First card'),
      journal: '{"rev":1,"at":"t1","type":"created","by":{"kind":"human"}}\n',
    })
    await writeCard('0002-second', { card: card('title: Second card'), journal: JOURNAL_TO_DESIGNING })
    const store = await boot()
    expect((await store.list({ stage: 'designing' })).map(c => c.id)).toEqual(['0002-second'])
    expect((await store.list({ stage: 'done' }))).toEqual([])
    const read = await store.read(DevflowCardId('0001-first'))
    expect(read.stage).toBe('draft')
  })

  it('reports blocked cards with their return stage', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-fs-'))
    await writeCard('0003-blocked', {
      card: card('title: Blocked card'),
      journal: [
        '{"rev":1,"at":"t1","type":"created","by":{"kind":"human"}}',
        '{"rev":2,"at":"t2","type":"transition","from":"draft","to":"designing"}',
        '{"rev":3,"at":"t3","type":"transition","from":"designing","to":"blocked","reason":"waiting on API"}',
      ].join('\n') + '\n',
    })
    const store = await boot()
    const read = await store.read(DevflowCardId('0003-blocked'))
    expect(read).toMatchObject({ stage: 'blocked', blockedFrom: 'designing', stageRevision: 3 })
  })

  it('warns on projection drift and lets the journal win', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-fs-'))
    await writeCard('0004-drift', {
      card: card('title: Drifted card\nstage: done\nstageRevision: 99'),
      journal: JOURNAL_TO_DESIGNING,
    })
    const store = await boot()
    const warn = vi.spyOn(context!.logger, 'warn').mockImplementation(() => {})
    const read = await store.read(DevflowCardId('0004-drift'))
    expect(read.stage).toBe('designing')
    expect(read.stageRevision).toBe(3)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('projection drift for card 0004-drift'))
    expect(warn.mock.calls[0][0]).toContain('the journal wins')
  })

  it.each([
    { label: 'invalid JSON', journal: '{"rev":1,\n', message: /journal\.jsonl:1: invalid JSON/ },
    { label: 'invalid entry', journal: '{"rev":1,"at":"t","type":"renamed"}\n', message: /journal\.jsonl:1: journal entry field "type"/ },
    { label: 'broken stream', journal: '{"rev":1,"at":"t","type":"created","by":{"kind":"human"}}\n{"rev":3,"at":"t","type":"transition","from":"draft","to":"ready"}\n', message: /journal\.jsonl: journal entry 2 carries rev 3/ },
  ])('fails loudly on $label naming the file', async ({ journal, message }) => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-fs-'))
    await writeCard('0005-bad', { card: card('title: Bad card'), journal })
    const store = await boot()
    await expect(store.read(DevflowCardId('0005-bad'))).rejects.toThrow(message)
  })

  it('rejects a card missing its journal; a lost card file degrades to the journal-only view', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-fs-'))
    await writeCard('0006-no-journal', { card: card('title: No journal') })
    await writeCard('0007-no-card', { journal: JOURNAL_TO_DESIGNING })
    const store = await boot()
    await expect(store.read(DevflowCardId('0006-no-journal'))).rejects.toThrow(/missing its required file.*journal\.jsonl/)
    await expect(store.read(DevflowCardId('0099-none'))).rejects.toThrow(/missing its required file/)
    const warn = vi.spyOn(context!.logger, 'warn').mockImplementation(() => {})
    const rebuilt = await store.read(DevflowCardId('0007-no-card'))
    expect(rebuilt).toMatchObject({ title: '0007-no-card', stage: 'designing', stageRevision: 3, body: '' })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('lost its projection file'))
  })

  it.each([
    { label: 'missing frontmatter', content: '# no frontmatter\n', message: 'must start with a YAML frontmatter block' },
    { label: 'unterminated frontmatter', content: '---\ntitle: x\n', message: 'must start with a YAML frontmatter block' },
    { label: 'non-mapping frontmatter', content: '---\n- 1\n---\n', message: 'frontmatter must be a YAML mapping' },
    { label: 'missing title', content: '---\nstage: draft\n---\n', message: 'requires a non-empty "title"' },
    { label: 'invalid projected stage', content: '---\ntitle: x\nstage: parked\n---\n', message: '"stage" is not a stage or "blocked"' },
    { label: 'invalid YAML', content: '---\ntitle: [\n---\n', message: 'invalid YAML frontmatter' },
  ])('rejects a card file with $label', async ({ content, message }) => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-fs-'))
    await writeCard('0008-badcard', { journal: '{"rev":1,"at":"t","type":"created","by":{"kind":"human"}}\n' })
    await writeFile(join(root, 'tasks', '0008-badcard', 'card.md'), content)
    const store = await boot()
    await expect(store.read(DevflowCardId('0008-badcard'))).rejects.toThrow(message)
  })

  it('returns an empty list for a missing root and skips non-card directory entries', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-fs-'))
    const store = await boot()
    expect(await store.list()).toEqual([])
    await mkdir(join(root, 'tasks', 'not-a-card'), { recursive: true })
    await writeFile(join(root, 'tasks', 'README.md'), 'not a card')
    expect(await store.list()).toEqual([])
  })

  it('rethrows non-absence errors instead of treating them as an empty board', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-fs-'))
    await writeCard('0009-locked', {
      card: card('title: Locked card'),
      journal: '{"rev":1,"at":"t","type":"created","by":{"kind":"human"}}\n',
    })
    const store = await boot()
    const tasksDir = join(root, 'tasks')
    const cardFile = join(tasksDir, '0009-locked', 'card.md')
    const journalFile = join(tasksDir, '0009-locked', 'journal.jsonl')
    injectFsAccessDenied({ operation: 'readFile', path: journalFile })
    await expect(store.read(DevflowCardId('0009-locked'))).rejects.toThrow(/EACCES/)
    injectFsAccessDenied({ operation: 'readFile', path: cardFile })
    await expect(store.read(DevflowCardId('0009-locked'))).rejects.toThrow(/EACCES/)
    injectFsAccessDenied({ operation: 'readdir', path: tasksDir })
    await expect(store.list()).rejects.toThrow(/EACCES/)
  })

  it('defaults the root to .devflow under direct application outside Loader normalization', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-default-root-'))
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root)
    const ctx = new Context()
    context = ctx
    let store!: FilesystemDevflowStore
    try {
      await ctx.plugin((child: Context) => {
        store = new FilesystemDevflowStore(child, {})
      })
      expect(await store.list()).toEqual([])
    } finally { cwd.mockRestore() }
  })

  it('unregisters ctx.devflow when the fiber disposes', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-devflow-fs-'))
    await boot()
    expect(context!.get('devflow')).toBeInstanceOf(FilesystemDevflowStore)
    await context!.fiber.dispose()
    expect(context!.get('devflow')).toBeUndefined()
    context = undefined
  })
})
