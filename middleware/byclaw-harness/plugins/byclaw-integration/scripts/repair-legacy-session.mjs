#!/usr/bin/env node

import { readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { repairLegacySessionArtifact } from '../lib/index.js'

async function artifactsAt(path) {
  const info = await stat(path)
  if (info.isFile()) return path.endsWith('.jsonl.zstd') ? [path] : []
  if (!info.isDirectory()) return []
  const entries = await readdir(path, { withFileTypes: true })
  const nested = await Promise.all(entries.map(entry => artifactsAt(join(path, entry.name))))
  return nested.flat()
}

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const targets = args.filter(arg => arg !== '--apply' && arg !== '--dry-run')
if (targets.length === 0) {
  console.error('Usage: byclaw-repair-legacy-session [--dry-run|--apply] <session.jsonl.zstd|directory> [...]')
  process.exitCode = 2
} else {
  const files = [...new Set((await Promise.all(targets.map(target => artifactsAt(resolve(target))))).flat())].sort()
  let failed = 0
  let changed = 0
  let changedArtifacts = 0
  let skippedArtifacts = 0
  for (const path of files) {
    try {
      const result = await repairLegacySessionArtifact(path, { apply })
      changed += result.changedEvents
      if (result.changedEvents === 0) skippedArtifacts += 1
      else changedArtifacts += 1
      console.info(JSON.stringify(result))
    } catch (error) {
      failed += 1
      console.error(JSON.stringify({ path, error: error instanceof Error ? error.message : String(error) }))
    }
  }
  console.info(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    scannedArtifacts: files.length,
    changedArtifacts,
    skippedArtifacts,
    changedEvents: changed,
    failedArtifacts: failed,
  }))
  if (failed > 0) process.exitCode = 1
}
