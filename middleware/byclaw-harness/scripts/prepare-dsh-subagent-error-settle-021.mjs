#!/usr/bin/env node
/**
 * Build-only: let a background child whose turn ended in error settle. DSH 0.2.1 forgets a child's
 * failure once its turn ending is committed, and then holds the settlement until the child's queued
 * input has run. A failed child stays idle, so input queued as its turn died (the notice of a
 * background job the failure killed) never runs: the parent gets no `subagent-settled` and waits for
 * a report that never comes. Keep the failure when the committed ending is an error; a later turn
 * that ends otherwise still clears it. Rebuild packages/subagent/subagent before use.
 */
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const supportedDshVersion = '0.2.1-rc.2'
export const marker = 'byclaw-subagent-error-settle-v1'

export const before = `  child.ctx.on('session/event', (session, event) => {
    if (session === child.session && event.type === 'turn/end'
      && activation.failureAt !== undefined && event.seq >= activation.failureAt) {
      activation.failureAt = undefined
    }
  })`

export const after = `  child.ctx.on('session/event', (session, event) => {
    if (session !== child.session || event.type !== 'turn/end') return
    // ${marker}: a failed child stays idle, so input queued behind its error ending never runs.
    if (event.data.reason.kind === 'error') {
      activation.failureAt = child.session.seq
      wake()
      return
    }
    if (activation.failureAt !== undefined && event.seq >= activation.failureAt) {
      activation.failureAt = undefined
    }
  })`

export function prepareSource(source) {
  if (source.includes(marker)) {
    if (source.split(after).length === 2 && !source.includes(before)) return source
    throw new Error('Unsupported mixed DSH subagent error settlement patch')
  }
  if (source.split(before).length !== 2) throw new Error('Unsupported DSH 0.2.1 subagent activation source')
  return source.replace(before, after)
}

export async function prepare(workspace) {
  const root = await realpath(workspace)
  const dir = join(root, 'packages/subagent/subagent')
  const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
  if (manifest.name !== '@deepseek-ai/dsh-subagent' || manifest.version !== supportedDshVersion) {
    throw new Error(`Expected @deepseek-ai/dsh-subagent@${supportedDshVersion}`)
  }
  const file = await realpath(join(dir, 'src/activation.ts'))
  if (relative(root, file).startsWith('..')) throw new Error('Source escapes build workspace')
  const source = await readFile(file, 'utf8')
  const updated = prepareSource(source)
  if (updated !== source) await writeFile(file, updated)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('Usage: prepare-dsh-subagent-error-settle-021.mjs WORKSPACE')
  await prepare(process.argv[2])
  console.log('DSH subagent error settlement prepared; rebuild packages/subagent/subagent before use')
}
