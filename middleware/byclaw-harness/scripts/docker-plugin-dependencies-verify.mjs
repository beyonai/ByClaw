#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const manifest = JSON.parse(await readFile(
  new URL('../plugins/dsh-better-sidebar/package.json', import.meta.url),
  'utf8',
))

assert.deepEqual(
  Object.keys(manifest.dependencies ?? {}).sort(),
  ['node-pty', 'schemastery', 'ws'],
  'better-sidebar production dependencies must contain only host runtime modules',
)

const bundledClientInputs = [
  '@codemirror/commands',
  '@codemirror/lang-cpp',
  '@codemirror/lang-css',
  '@codemirror/lang-go',
  '@codemirror/lang-html',
  '@codemirror/lang-java',
  '@codemirror/lang-javascript',
  '@codemirror/lang-json',
  '@codemirror/lang-markdown',
  '@codemirror/lang-php',
  '@codemirror/lang-python',
  '@codemirror/lang-rust',
  '@codemirror/lang-sql',
  '@codemirror/lang-vue',
  '@codemirror/lang-xml',
  '@codemirror/lang-yaml',
  '@codemirror/language',
  '@codemirror/legacy-modes',
  '@codemirror/search',
  '@codemirror/state',
  '@codemirror/view',
  '@lezer/highlight',
  'clsx',
  'dompurify',
  'mermaid',
  'react-icons',
  'rxjs',
]

for (const dependency of bundledClientInputs) {
  assert.equal(
    typeof manifest.devDependencies?.[dependency],
    'string',
    `${dependency} must remain available as a browser bundle build input`,
  )
}

console.log('docker plugin dependency verification passed')
