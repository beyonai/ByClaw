#!/usr/bin/env node

/**
 * Backport request-error reassembly to the DSH release used by our base image.
 * This is a build-time operation on an explicitly supplied disposable workspace.
 * It never discovers or edits a sibling checkout or an installed node_modules.
 */
import { readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const supportedDshVersion = '0.1.5-rc.2'
export const runtimePackages = ['packages/core/agent', 'packages/core/agent-loop']
const capability = 'byclawRequestReassembly'

const loopEdits = [
  [
    `    const { assembly } = decision
    const renderedPrompt = renderPrompt(assembly)
    let firstAttempt = true`,
    `    // byclaw-request-reassembly-v1: one step keeps its admitted input and tools' results.
    let { assembly } = decision
    let renderedPrompt = renderPrompt(assembly)
    let recoveryContext: UserMessage | undefined
    let recoverySeries = false
    let firstAttempt = true`,
  ],
  [
    `      const startsRequestSeries = firstAttempt && decision.startsRequestSeries === true`,
    `      const startsRequestSeries = recoverySeries || (firstAttempt && decision.startsRequestSeries === true)`,
  ],
  [
    `      firstAttempt = false
      const request = this.buildRequest(config, preparedCall, assembly.tools, startsRequestSeries, signal)
      const live = new AssistantStreamAttempt(`,
    `      if (recoveryContext !== undefined) {
        this.session.append('user/message', recoveryContext, { surfaceOp: 'append' })
        recoveryContext = undefined
      }
      firstAttempt = false
      const request = this.buildRequest(config, preparedCall, assembly.tools, startsRequestSeries, signal)
      recoverySeries = false
      const live = new AssistantStreamAttempt(`,
  ],
  [
    `          if (action?.kind !== 'retry') {
            throw new LlmError(finish.failure.message, finish.failure.code, finish.failure)
          }
          continue`,
    `          if (action?.kind !== 'retry') {
            throw new LlmError(finish.failure.message, finish.failure.code, finish.failure)
          }
          if (action.reassemble === true) {
            assembly = await this.loopCtx.systemPrompt.assemble(assembleContextFor(this, signal))
            signal.throwIfAborted()
            renderedPrompt = renderPrompt(assembly)
            const sections = renderContextSections(assembly)
            recoveryContext = this.runtimeContext.project(joinContextSections(sections), sections)
            recoverySeries = true
          }
          continue`,
  ],
]

const typeEdits = [[
  `export type RequestErrorAction = { kind: 'retry' } | undefined`,
  `export type RequestErrorAction = {
  kind: 'retry'
  /** Rebuild prompt, tools and runtime context before retrying this same step. */
  reassemble?: true
} | undefined`,
]]

const entryEdits = [[
  `import { DEFAULT_MAX_PARALLEL_TOOL_CALLS } from './constants.ts'\n\n`,
  `import { DEFAULT_MAX_PARALLEL_TOOL_CALLS } from './constants.ts'\n\n/** This build supports retrying one admitted step with fresh model-dependent assembly. */
export const byclawRequestReassembly = true

`,
], [
  `export class AgentLoop extends Service implements AgentFactory {
  static inject = ['agents', 'sessions', 'llm', 'tools', 'systemPrompt', 'sessionProjections']`,
  `export class AgentLoop extends Service implements AgentFactory {
  /** Capability of this live factory, independent of other installed module copies. */
  readonly byclawRequestReassembly = true
  static inject = ['agents', 'sessions', 'llm', 'tools', 'systemPrompt', 'sessionProjections']`,
]]

function count(source, text) { return source.split(text).length - 1 }

/** Only a complete original or complete patched shape is accepted within a file. */
function transform(source, edits, label) {
  const statuses = edits.map(([before, after]) => {
    if (count(source, after) === 1 && count(source.replace(after, ''), before) === 0) return 'patched'
    if (count(source, before) === 1 && count(source, after) === 0) return 'original'
    throw new Error(`${label}: unsupported source shape; refusing to guess at a compatibility patch`)
  })
  if (new Set(statuses).size !== 1) throw new Error(`${label}: incomplete compatibility patch; restore this file before retrying`)
  if (statuses[0] === 'patched') return { source, patched: true }
  return { source: edits.reduce((value, [before, after]) => value.replace(before, after), source), patched: false }
}

/** Pure source transformation, exported so fixture tests never need a real DSH checkout. */
export function prepareRuntimeSources({ loop, types, entry }) {
  for (const anchor of [
    'private async step(decision:',
    'UserMessage',
    'renderContextSections',
    'joinContextSections',
    'assembleContextFor',
    'this.systemPrompt.project(renderedPrompt,',
    "this.dispatch.emit('agent/assistant-stream', { frame })",
  ]) {
    if (!loop.includes(anchor)) throw new Error(`agent-loop/src/agent.ts: missing expected release surface ${anchor}`)
  }
  const result = {
    types: transform(types, typeEdits, 'agent/src/runtime-types.ts'),
    loop: transform(loop, loopEdits, 'agent-loop/src/agent.ts'),
    entry: transform(entry, entryEdits, 'agent-loop/src/index.ts'),
  }
  if (entry.includes(capability) && !result.entry.patched) throw new Error('An unrecognized runtime capability declaration already exists')
  if (result.entry.patched && (!result.loop.patched || !result.types.patched)) {
    throw new Error('Runtime declares reassembly support but its implementation or type contract is missing')
  }
  return result
}

async function confinedFile(root, path) {
  const resolved = await realpath(join(root, path))
  const fromRoot = relative(root, resolved)
  if (fromRoot === '..' || fromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(fromRoot)) {
    throw new Error(`Refusing a workspace file that resolves outside the explicit workspace: ${path}`)
  }
  const information = await stat(resolved)
  if (!information.isFile()) throw new Error(`Expected a regular workspace file: ${path}`)
  return { path: resolved, mode: information.mode & 0o777, source: await readFile(resolved, 'utf8') }
}

/** Validate every file before writing, and publish the runtime capability last. */
export async function prepareRuntime(workspace, { check = false } = {}) {
  if (typeof workspace !== 'string' || workspace.trim() === '') throw new Error('An explicit --workspace path is required')
  const root = await realpath(resolve(workspace))
  const manifests = []
  for (const directory of runtimePackages) {
    const file = await confinedFile(root, `${directory}/package.json`)
    const manifest = JSON.parse(file.source)
    const expectedName = directory.endsWith('/agent-loop') ? '@deepseek-ai/dsh-agent-loop' : '@deepseek-ai/dsh-agent'
    if (manifest.name !== expectedName || manifest.version !== supportedDshVersion) {
      throw new Error(`${directory}: expected ${expectedName}@${supportedDshVersion}; received ${manifest.name}@${manifest.version}`)
    }
    manifests.push(file.path)
  }
  const files = {
    types: await confinedFile(root, 'packages/core/agent/src/runtime-types.ts'),
    loop: await confinedFile(root, 'packages/core/agent-loop/src/agent.ts'),
    entry: await confinedFile(root, 'packages/core/agent-loop/src/index.ts'),
  }
  const prepared = prepareRuntimeSources(Object.fromEntries(Object.entries(files).map(([key, file]) => [key, file.source])))
  const changes = Object.entries(files).filter(([key]) => !prepared[key].patched)
  if (!check && changes.length > 0) {
    const staged = []
    try {
      for (const [key, file] of changes) {
        const temporary = join(dirname(file.path), `.byclaw-reassembly-${randomUUID()}.tmp`)
        staged.push({ temporary, file })
        await writeFile(temporary, prepared[key].source, { mode: file.mode, flag: 'wx' })
      }
      for (const { file } of staged) {
        if (await readFile(file.path, 'utf8') !== file.source) throw new Error(`Workspace changed during preparation: ${file.path}`)
      }
      for (const { temporary, file } of staged) await rename(temporary, file.path)
    } finally {
      await Promise.all(staged.map(({ temporary }) => unlink(temporary).catch(error => {
        if (error.code !== 'ENOENT') throw error
      })))
    }
  }
  return { workspace: root, manifests, changed: changes.length, ready: !check || changes.length === 0 }
}

function parseArguments(argv) {
  let workspace
  let check = false
  let manifests = false
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]
    if (argument === '--workspace' && workspace === undefined) workspace = argv[++index]
    else if (argument === '--check') check = true
    else if (argument === '--manifests') { manifests = true; check = true }
    else throw new Error(`Unknown argument: ${argument}`)
  }
  if (!workspace || workspace.startsWith('--')) throw new Error('Usage: prepare-dsh-model-routing-runtime.mjs --workspace PATH [--check | --manifests]')
  return { workspace, check, manifests }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2))
    const result = await prepareRuntime(options.workspace, options)
    if (!result.ready) {
      console.error(`DSH model-routing compatibility patch is required for ${result.changed} source file(s)`)
      process.exitCode = 1
    } else if (options.manifests) {
      process.stdout.write(`${result.manifests.join('\n')}\n`)
    } else {
      console.log(`DSH ${supportedDshVersion} request reassembly ${result.changed === 0 ? 'already prepared' : 'prepared'}; rebuild and pack both core packages before using them`)
    }
  } catch (error) {
    console.error(`DSH model-routing compatibility: ${error.message}`)
    process.exitCode = 1
  }
}
