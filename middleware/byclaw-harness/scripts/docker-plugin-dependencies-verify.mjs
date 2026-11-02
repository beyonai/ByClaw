#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const manifest = JSON.parse(await readFile(
  new URL('../plugins/dsh-better-sidebar/package.json', import.meta.url),
  'utf8',
))

assert.deepEqual(
  Object.keys(manifest.dependencies ?? {}).sort(),
  ['@deepseek-ai/schemastery', 'node-pty', 'ws'],
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

const toolEnvManifest = JSON.parse(await readFile(
  new URL('../plugins/dsh-tool-env/package.json', import.meta.url),
  'utf8',
))

assert.equal(
  toolEnvManifest.dependencies?.['@deepseek-ai/dsh-tools'],
  undefined,
  'tool-env must not install a second dsh-tools runtime into the managed profile',
)
assert.equal(
  toolEnvManifest.peerDependencies?.['@deepseek-ai/dsh-tools'],
  '0.2.1-rc.2',
  'tool-env must use the DSH host tool runtime',
)
assert.equal(
  toolEnvManifest.devDependencies?.['@deepseek-ai/dsh-tools'],
  'workspace:*',
  'tool-env still needs the workspace tool runtime while building and testing',
)

console.log('docker plugin dependency verification passed')
