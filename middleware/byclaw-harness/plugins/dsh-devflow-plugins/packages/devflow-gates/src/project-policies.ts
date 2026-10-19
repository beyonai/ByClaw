/** Project-required validators remain enforced when their provider is unloaded. */
import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { RequiredValidatorPolicy } from './types.ts'

/** This optional file is managed by project setup tools, under the Devflow write fence. */
export async function projectPolicies(root: string): Promise<RequiredValidatorPolicy[]> {
  let rootStat
  try { rootStat = await lstat(root) }
  catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return []; throw error }
  if (!rootStat.isDirectory()) throw new Error('Invalid project validation root')
  const canonical = await realpath(root)
  const path = join(canonical, 'validation.json')
  let expected
  try { expected = await lstat(path) }
  catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return []; throw error }
  if (!expected.isFile()) throw new Error('Invalid project validation policy file')
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    if (await realpath(path) !== resolve(path)) throw new Error('Aliased project validation policy')
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > 65_536 || stat.ino !== expected.ino || stat.dev !== expected.dev) throw new Error('Invalid project validation policy size or identity')
    const value: unknown = JSON.parse(await file.readFile('utf8'))
    if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 || !('requirements' in value) || !Array.isArray(value.requirements)) throw new Error('Invalid project validation policy')
    return value.requirements.map((entry: unknown) => {
      if (!entry || typeof entry !== 'object' || !('validators' in entry) || !('edges' in entry) || !('timeoutMs' in entry)) throw new Error('Invalid project validator requirement')
      const strings = (input: unknown): string[] => {
        if (!Array.isArray(input) || input.length === 0 || !input.every((item: unknown) => typeof item === 'string' && item.trim().length > 0)) throw new Error('Invalid project validator list')
        return input as string[]
      }
      if (typeof entry.timeoutMs !== 'number' || !Number.isSafeInteger(entry.timeoutMs) || entry.timeoutMs < 1) throw new Error('Invalid project validator timeout')
      return { root: canonical, validators: strings(entry.validators), edges: strings(entry.edges), timeoutMs: entry.timeoutMs,
        ...('cards' in entry ? { cards: strings(entry.cards) } : {}) }
    })
  } finally { await file.close() }
}
