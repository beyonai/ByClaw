/**
 * Every bilingual pair's consistency record names the two files as they stand.
 *
 * The record is the only mechanism keeping a one-sided edit visible: nothing
 * else notices when an English page gains a paragraph its Chinese counterpart
 * never gets. A stale record is worse than none, because it reads as a
 * confirmation that the pair was checked. Four of these drifted for weeks
 * after the line was extracted — the records were carried over from the
 * upstream checkout, so they named blobs this repository has never held — and
 * nothing said so until someone happened to look.
 *
 * A failure here is not resolved by re-recording alone: check that both sides
 * actually say the same thing first, THEN re-record.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** One recorded side: the file the record names and the hash it claims. */
interface RecordedSide {
  readonly file: string
  readonly recorded: string
}

function findRecords(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'lib') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) findRecords(path, found)
    else if (entry.name.endsWith('.i18n.yaml')) found.push(path)
  }
  return found
}

/** The `<file>: <hash>` lines of one record, ignoring its comment header. */
function sidesOf(record: string): RecordedSide[] {
  const sides: RecordedSide[] = []
  for (const line of readFileSync(record, 'utf8').split('\n')) {
    if (line.startsWith('#')) continue
    const separator = line.indexOf(': ')
    if (separator < 0) continue
    const name = line.slice(0, separator)
    if (!name.endsWith('.md')) continue
    sides.push({ file: join(record, '..', name), recorded: line.slice(separator + 2).trim() })
  }
  return sides
}

function blobHash(file: string): string {
  return execFileSync('git', ['hash-object', file], { cwd: ROOT, encoding: 'utf8' }).trim()
}

describe('bilingual pair records', () => {
  const records = findRecords(ROOT)

  it('finds the records at all, so an empty sweep cannot pass vacuously', () => {
    expect(records.length).toBeGreaterThan(10)
  })

  it.each(records.map(record => [relative(ROOT, record), record] as const))(
    '%s names both sides as they stand',
    (_label, record) => {
      const sides = sidesOf(record)
      // A record naming fewer than two files documents nothing.
      expect(sides.length).toBe(2)
      for (const side of sides) {
        expect(statSync(side.file).isFile()).toBe(true)
        expect({ file: relative(ROOT, side.file), hash: side.recorded })
          .toEqual({ file: relative(ROOT, side.file), hash: blobHash(side.file) })
      }
    },
  )
})
