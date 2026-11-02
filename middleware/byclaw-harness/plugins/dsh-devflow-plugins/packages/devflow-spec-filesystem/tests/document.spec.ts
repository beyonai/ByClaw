// The document file format at its durable boundary: a round trip preserves the
// anchors, and every ill-formed field fails loudly naming the file and the
// constraint rather than being defaulted into a plausible document.
import { describe, expect, it } from 'vitest'
import { decodeSpecFile, encodeSpecFile } from '@zhchxiao123/dsh-devflow-spec-filesystem'
import type { SpecAnchor } from '@zhchxiao123/dsh-devflow-spec'

const ANCHORS: SpecAnchor[] = [
  { id: 'a1', kind: 'symbol', file: 'src/types.ts', symbol: 'DevStage' },
  { id: 'a2', kind: 'content-hash', file: 'src/stages.ts', symbol: 'isLegal', hash: 'sha1:abc' },
  { id: 'a3', kind: 'churn', file: 'cordis.yml' },
]

const FILE = {
  title: 'Error Handling',
  description: 'Domain rejections versus infrastructure failures',
  updatedAt: '2026-09-02T00:00:00.000Z',
  anchors: ANCHORS,
  body: '## Source of truth\n\nRests on [[a1]], [[a2]], [[a3]].\n',
}

function frontmatter(fields: string): string {
  return `---\n${fields}\n---\n## Source of truth\n`
}

describe('round trip', () => {
  it('preserves every field and all three anchor kinds', () => {
    expect(decodeSpecFile(encodeSpecFile(FILE), 'doc.md')).toEqual(FILE)
  })

  it('preserves the waived scopes, and omits the key entirely when there are none', () => {
    const waiving = { ...FILE, waives: ['examples/with-nextjs', 'examples/with-script-in-browser'] }
    expect(decodeSpecFile(encodeSpecFile(waiving), 'doc.md')).toEqual(waiving)
    expect(encodeSpecFile(FILE)).not.toContain('waives')
    expect(decodeSpecFile(encodeSpecFile(FILE), 'doc.md')).not.toHaveProperty('waives')
  })

  it('omits an absent description rather than writing a null', () => {
    const { description: _dropped, ...withoutDescription } = FILE
    const encoded = encodeSpecFile(withoutDescription)
    expect(encoded).not.toContain('description')
    expect(decodeSpecFile(encoded, 'doc.md')).toEqual(withoutDescription)
  })
})

describe('decode failures name the file and the constraint', () => {
  it('rejects a file with no frontmatter', () => {
    expect(() => decodeSpecFile('# Title\n', 'doc.md')).toThrow(/doc\.md has no frontmatter/)
  })

  it('rejects frontmatter that is not a mapping', () => {
    expect(() => decodeSpecFile('---\n- a\n---\n', 'doc.md')).toThrow(/must be a mapping/)
    expect(() => decodeSpecFile('---\nnull\n---\n', 'doc.md')).toThrow(/must be a mapping/)
  })

  it('rejects missing or ill-typed top-level fields', () => {
    expect(() => decodeSpecFile(frontmatter('updatedAt: t\nanchors: []'), 'doc.md')).toThrow(/non-empty "title"/)
    expect(() => decodeSpecFile(frontmatter('title: T\nupdatedAt: t\nanchors: []\ndescription: 3'), 'doc.md')).toThrow(/"description" must be a string/)
    expect(() => decodeSpecFile(frontmatter('title: T\nanchors: []'), 'doc.md')).toThrow(/non-empty "updatedAt"/)
    expect(() => decodeSpecFile(frontmatter('title: T\nupdatedAt: t'), 'doc.md')).toThrow(/"anchors" list/)
  })

  it('rejects a "waives" field that is not a list of scope ids', () => {
    const head = 'title: T\nupdatedAt: t\nanchors: []\n'
    expect(() => decodeSpecFile(frontmatter(`${head}waives: examples/with-nextjs`), 'doc.md')).toThrow(/"waives" must be a list/)
    expect(() => decodeSpecFile(frontmatter(`${head}waives:\n  - ''`), 'doc.md')).toThrow(/"waives" must be a list/)
    expect(() => decodeSpecFile(frontmatter(`${head}waives:\n  - 3`), 'doc.md')).toThrow(/"waives" must be a list/)
  })

  it('rejects an anchor entry that is not a mapping', () => {
    expect(() => decodeSpecFile(frontmatter('title: T\nupdatedAt: t\nanchors:\n  - scalar'), 'doc.md')).toThrow(/anchors\[0\] must be a mapping/)
  })

  it('rejects anchor fields every kind needs', () => {
    const head = 'title: T\nupdatedAt: t\nanchors:\n  - '
    expect(() => decodeSpecFile(frontmatter(`${head}kind: churn\n    file: f`), 'doc.md')).toThrow(/non-empty "id"/)
    expect(() => decodeSpecFile(frontmatter(`${head}id: a1\n    kind: line-range\n    file: f`), 'doc.md')).toThrow(/expected symbol, content-hash, or churn/)
    expect(() => decodeSpecFile(frontmatter(`${head}id: a1\n    kind: churn`), 'doc.md')).toThrow(/non-empty "file"/)
  })

  it('rejects a symbolic anchor with no symbol, and a content-hash anchor with no hash', () => {
    const head = 'title: T\nupdatedAt: t\nanchors:\n  - '
    expect(() => decodeSpecFile(frontmatter(`${head}id: a1\n    kind: symbol\n    file: f.ts`), 'doc.md')).toThrow(/must carry a non-empty "symbol"/)
    expect(() => decodeSpecFile(frontmatter(`${head}id: a1\n    kind: content-hash\n    file: f.ts\n    symbol: S`), 'doc.md')).toThrow(/must carry a non-empty "hash"/)
  })
})
