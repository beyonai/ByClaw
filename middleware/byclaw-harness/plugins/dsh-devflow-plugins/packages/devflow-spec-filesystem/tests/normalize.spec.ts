// The content-hash normalization: what must not move a hash (formatting) and
// what must (implementation). These cases are the contract — a hash that moves
// on `pnpm run format` would mark every anchor stale at once and train everyone
// to ignore the signal, and one that survives an edited line protects nothing.
import { describe, expect, it } from 'vitest'
import { hashSymbol, normalizeSymbolBody } from '@zhchxiao123/dsh-devflow-spec-filesystem'

const ORIGINAL = `export function isLegalTransition(from: string, to: string): boolean {
  // Main flow follows the pipeline order.
  if (from === to) return false
  return FLOW[from].includes(to)
}`

function hashOf(source: string, symbol = 'isLegalTransition'): string | undefined {
  return hashSymbol(source, symbol)
}

describe('normalizeSymbolBody', () => {
  it('strips comments and collapses whitespace', () => {
    const normalized = normalizeSymbolBody(ORIGINAL)
    expect(normalized).not.toContain('Main flow')
    expect(normalized).not.toContain('\n')
    expect(normalized).not.toMatch(/ {2}/)
  })
})

describe('hashSymbol', () => {
  it('carries the algorithm in the value', () => {
    expect(hashOf(ORIGINAL)).toMatch(/^sha1:[0-9a-f]{40}$/)
  })

  it('survives reformatting', () => {
    const reformatted = `export function isLegalTransition( from: string, to: string ): boolean {
        // Main flow follows the pipeline order.
        if (from === to) return false;
        return FLOW[from].includes(to);
}`
    expect(hashOf(reformatted)).toBe(hashOf(ORIGINAL))
  })

  it('survives a comment rewrite, because a comment is not the implementation', () => {
    const recommented = ORIGINAL.replace('// Main flow follows the pipeline order.', '/* Pipeline order. */')
    expect(hashOf(recommented)).toBe(hashOf(ORIGINAL))
  })

  it('moves when one line of implementation changes', () => {
    const edited = ORIGINAL.replace('if (from === to) return false', 'if (from === to) return true')
    expect(hashOf(edited)).not.toBe(hashOf(ORIGINAL))
  })

  it('does not mistake a comment marker inside a string literal for a comment', () => {
    const withUrl = 'export const HOME = "https://example.com/path"'
    const withoutUrl = 'export const HOME = "https:"'
    expect(hashOf(withUrl, 'HOME')).not.toBe(hashOf(withoutUrl, 'HOME'))
    expect(normalizeSymbolBody(withUrl)).toContain('https://example.com/path')
  })

  it('finds each of the declaration forms a spec cites', () => {
    expect(hashOf('export type DevStage = "draft" | "done"', 'DevStage')).toBeDefined()
    expect(hashOf('export interface DevCard { id: string }', 'DevCard')).toBeDefined()
    expect(hashOf('export class Store { run() {} }', 'Store')).toBeDefined()
    expect(hashOf('export enum Level { Low, High }', 'Level')).toBeDefined()
    expect(hashOf('export const DEV_STAGES = ["draft"] as const', 'DEV_STAGES')).toBeDefined()
    expect(hashOf('function local() { return 1 }', 'local')).toBeDefined()
  })

  it('resolves either name of a multi-declarator statement to the whole statement', () => {
    const source = 'const first = 1, second = 2'
    expect(hashOf(source, 'first')).toBe(hashOf(source, 'second'))
  })

  it('looks past statements that bind no matching name', () => {
    const noise = [
      'import { join } from "node:path"',
      'export default class {}',
      'const { destructured } = config',
      'const other = 1',
      'console.log(join)',
      'export function target() { return 2 }',
    ].join('\n')
    expect(hashOf(noise, 'target')).toBeDefined()
    expect(hashOf(noise, 'destructured')).toBeUndefined()
  })

  it('reports a symbol it cannot find rather than hashing the whole file', () => {
    expect(hashOf(ORIGINAL, 'noSuchSymbol')).toBeUndefined()
  })
})
