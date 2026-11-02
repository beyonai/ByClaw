// The `ocr delegate` boundary, exercised against output the real CLI actually
// produced. `tests/fixtures/` holds captures from open-code-review v1.12.0 run
// over a scratch repository — parsing is asserted against those bytes rather
// than against the shapes the upstream Skill documentation describes in prose,
// because the two disagree: the prose promises a `status: "skipped"` envelope
// for an empty review, and the delegate output carries no `status` at all.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  COMMAND_LINE_BUDGET,
  MIN_OCR_VERSION,
  ReviewError,
  batchPaths,
  meetsMinimum,
  mergeRuleGroups,
  parsePreview,
  parseRuleGroups,
  parseVersion,
  shellQuote,
} from '@zhchxiao123/dsh-devflow-review-gate/src/ocr.ts'
import type { RuleGroup } from '@zhchxiao123/dsh-devflow-review-gate/src/types.ts'

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8')
}

describe('shell quoting', () => {
  it.each([
    ['plain.ts', "'plain.ts'"],
    ['with space.ts', "'with space.ts'"],
    ["we'ird $name.ts", "'we'\\''ird $name.ts'"],
    ['`backtick`.ts', "'`backtick`.ts'"],
    ['multi\nline.ts', "'multi\nline.ts'"],
  ])('reproduces %j byte for byte', (raw, quoted) => {
    expect(shellQuote(raw)).toBe(quoted)
  })

  it('keeps every embedded quote escaped, however many there are', () => {
    expect(shellQuote("a'b'c")).toBe("'a'\\''b'\\''c'")
  })
})

describe('version gating', () => {
  it('reads the triple out of the real --version banner', () => {
    expect(parseVersion(fixture('version.txt'))).toEqual({ major: 1, minor: 12, patch: 0 })
  })

  it('returns undefined when no triple is present', () => {
    expect(parseVersion('some other program')).toBeUndefined()
  })

  it.each([
    ['1.9.0', true],
    ['1.12.0', true],
    ['2.0.0', true],
    ['1.8.9', false],
    ['0.99.99', false],
  ])('accepts v%s against the minimum: %s', (candidate, expected) => {
    expect(meetsMinimum(parseVersion(candidate)!, MIN_OCR_VERSION)).toBe(expected)
  })
})

describe('preview parsing', () => {
  it('reads range mode, including the merge base every diff is taken from', () => {
    const preview = parsePreview(fixture('preview-range.json'))
    expect(preview.mode).toBe('range')
    expect(preview.from).toBe('main')
    expect(preview.to).toBe('feature')
    expect(preview.mergeBase).toMatch(/^[0-9a-f]{40}$/)
    expect(preview.reviewable.length).toBeGreaterThan(0)
    const first = preview.reviewable[0]
    expect(typeof first.path).toBe('string')
    expect(typeof first.status).toBe('string')
    expect(Number.isFinite(first.insertions)).toBe(true)
    expect(Number.isFinite(first.deletions)).toBe(true)
  })

  it('reads workspace mode, which carries no refs', () => {
    const preview = parsePreview(fixture('preview-workspace.json'))
    expect(preview.mode).toBe('workspace')
    expect(preview.from).toBeUndefined()
    expect(preview.mergeBase).toBeUndefined()
    expect(preview.reviewable.map(file => file.path)).toEqual(['src.ts'])
  })

  it('carries each exclusion reason through for the report', () => {
    const preview = parsePreview(fixture('preview-workspace.json'))
    expect(preview.excluded).toEqual([
      { path: 'note.md', status: 'added', insertions: 1, deletions: 0, excludeReason: 'unsupported_ext' },
    ])
  })

  it('reads an empty review off the file list, there being no status field to read', () => {
    const preview = parsePreview(fixture('preview-empty.json'))
    expect(preview.reviewable).toEqual([])
    expect(preview.excluded).toEqual([])
    expect(JSON.parse(fixture('preview-empty.json'))).not.toHaveProperty('status')
  })

  it.each([
    ['not json at all', 'is not valid JSON'],
    ['[]', 'is not a JSON object'],
    ['{"repository":"/r","reviewable_files":[],"excluded_files":[]}', 'is missing a string "mode"'],
    ['{"mode":"range","repository":"/r","excluded_files":[]}', 'is missing an array "reviewable_files"'],
    ['{"mode":"range","repository":"/r","reviewable_files":[{"status":"added"}],"excluded_files":[]}', 'is missing a string "path"'],
    ['{"mode":"range","repository":"/r","reviewable_files":[{"path":"a","status":"added","insertions":"x"}],"excluded_files":[]}', 'has a non-numeric "insertions"'],
    ['{"mode":"range","repository":"/r","from":7,"reviewable_files":[],"excluded_files":[]}', 'has a non-string "from"'],
  ])('faults on %j', (raw, message) => {
    expect(() => parsePreview(raw)).toThrow(ReviewError)
    expect(() => parsePreview(raw)).toThrow(message)
  })

  it('defaults a missing exclusion reason rather than dropping the file', () => {
    const preview = parsePreview('{"mode":"workspace","repository":"/r","reviewable_files":[],"excluded_files":[{"path":"a","status":"added"}]}')
    expect(preview.excluded[0]).toMatchObject({ path: 'a', excludeReason: 'unspecified' })
  })
})

describe('rule parsing', () => {
  it('reads one group per distinct rule, with the rule body verbatim', () => {
    const groups = parseRuleGroups(fixture('rule-two-groups.json'))
    expect(groups.map(group => group.pattern)).toEqual(['**/*.go', '**/*.{ts,js,tsx,jsx,mjs,cjs}'])
    expect(groups[0].files).toEqual(['main.go'])
    expect(groups[0].source).toBe('system')
    expect(groups[0].rule).toContain('Go Review Principles')
  })

  // The CLI resolves a repository's own `.opencodereview/rule.json` ahead of
  // its built-ins, and marks which won. The gate neither reads nor overrides
  // that file — it passes the resolved rule to a checker verbatim — so a
  // project's rules reaching the reviewer is a property of this parse plus the
  // CLI, and this fixture is the evidence for it.
  it('carries a project rule through, distinguished from a built-in by its source', () => {
    const groups = parseRuleGroups(fixture('rule-project-and-system.json'))
    const project = groups.find(group => group.source === 'project')
    expect(project).toBeDefined()
    expect(project!.files).toEqual(['src.ts'])
    expect(project!.rule).toContain('PROJECT RULE')
    expect(groups.some(group => group.source === 'system')).toBe(true)
  })

  it('reads the fallback group an unmatched extension lands in', () => {
    const groups = parseRuleGroups(fixture('rule-default-group.json'))
    expect(groups).toHaveLength(1)
    expect(groups[0].pattern).toBe('default')
    expect(groups[0].files).toEqual(['scratch.txt'])
  })

  it.each([
    ['{', 'is not valid JSON'],
    ['{"schema_version":"1"}', 'is missing an array "groups"'],
    ['{"groups":[{"source":"system","files":[],"rule":"r"}]}', 'is missing a string "pattern"'],
    ['{"groups":[{"pattern":"p","source":"system","rule":"r","files":[1]}]}', 'has a non-string file at 0'],
  ])('faults on %j', (raw, message) => {
    expect(() => parseRuleGroups(raw)).toThrow(message)
  })
})

describe('command-line batching', () => {
  it('sends one call when the paths fit', () => {
    expect(batchPaths(['a.ts', 'b.ts'])).toEqual([['a.ts', 'b.ts']])
  })

  it('returns no batches for no paths, so no call is made', () => {
    expect(batchPaths([])).toEqual([])
  })

  it('splits once the quoted forms exceed the budget', () => {
    const batches = batchPaths(['aaaa', 'bbbb', 'cccc'], 14)
    expect(batches).toEqual([['aaaa', 'bbbb'], ['cccc']])
  })

  it('keeps an over-budget path in a batch of its own rather than dropping it', () => {
    const long = 'x'.repeat(50)
    expect(batchPaths(['a', long, 'b'], 10)).toEqual([['a'], [long], ['b']])
  })

  it('holds a realistic change in a single call', () => {
    const paths = Array.from({ length: 400 }, (_unused, index) => `packages/some-package/src/file${index}.ts`)
    expect(batchPaths(paths)).toHaveLength(1)
    expect(COMMAND_LINE_BUDGET).toBeGreaterThan(paths.join(' ').length)
  })
})

describe('merging batched rule groups', () => {
  const rule = (pattern: string, body: string, files: string[]): RuleGroup =>
    ({ pattern, source: 'system', rule: body, files })

  it('restores the single group a one-shot call would have produced', () => {
    expect(mergeRuleGroups([
      [rule('**/*.ts', 'TS rules', ['a.ts'])],
      [rule('**/*.ts', 'TS rules', ['b.ts'])],
    ])).toEqual([rule('**/*.ts', 'TS rules', ['a.ts', 'b.ts'])])
  })

  it('keeps groups whose rule body differs apart, even under one pattern', () => {
    expect(mergeRuleGroups([
      [rule('default', 'first', ['a']), rule('default', 'second', ['b'])],
    ])).toHaveLength(2)
  })

  it('lists a file once when two batches both report it', () => {
    expect(mergeRuleGroups([
      [rule('**/*.ts', 'TS rules', ['a.ts'])],
      [rule('**/*.ts', 'TS rules', ['a.ts'])],
    ])[0].files).toEqual(['a.ts'])
  })

  it('preserves first-appearance order across batches', () => {
    expect(mergeRuleGroups([
      [rule('**/*.go', 'Go', ['m.go'])],
      [rule('**/*.ts', 'TS', ['a.ts']), rule('**/*.go', 'Go', ['n.go'])],
    ]).map(group => group.pattern)).toEqual(['**/*.go', '**/*.ts'])
  })

  it('does not mutate the batches it was given', () => {
    const first = rule('**/*.ts', 'TS', ['a.ts'])
    mergeRuleGroups([[first], [rule('**/*.ts', 'TS', ['b.ts'])]])
    expect(first.files).toEqual(['a.ts'])
  })
})
