const DENIAL_CODE = 'DIRECT_BROWSER_ACCESS_DENIED' as const
const DENIAL_MESSAGE = 'Direct browser access is disabled; use the DSH browser tool.'

const DIRECT_BROWSER_EXECUTABLE = /^(?:@playwright\/test|browser[-_]use|chrome(?:-headless-shell)?|chrome-remote-interface|chromium(?:-browser)?|google(?: |-)chrome(?:-(?:beta|canary|stable|unstable))?|playwright(?:-core)?)$/u
const SHELL_EXECUTABLE = /^(?:ba|da|z)?sh$/u
const NODE_EXECUTABLE = /^(?:bun|node|nodejs)$/u
const PYTHON_EXECUTABLE = /^python(?:\d+(?:\.\d+)?)?$/u
const ENVIRONMENT_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/u
const REMOTE_CONTROL_ARGUMENT = /^--(?:(?:remote-)?debugging(?:-|=|$)|cdp(?:-|=|$)|connect-over-cdp(?:=|$))/u
const CDP_ENDPOINT = /^(?:(?:http|ws)s?:\/\/[^/]+\/(?:devtools\/(?:browser|page)\/|json(?:\/(?:list|protocol|version))?(?:[?#]|$)))/iu
const NETWORK_EXECUTABLES = new Set(['curl', 'websocat', 'wget'])
const MAX_PACKAGE_RUNNER_UNWRAPS = 64
const DOCUMENTATION_EXECUTABLES = new Set([
  'awk',
  'cat',
  'echo',
  'grep',
  'head',
  'less',
  'printf',
  'rg',
  'sed',
  'tail',
])
const PACKAGE_MANAGER_NON_RUNTIME_ACTIONS = new Set([
  'add',
  'build',
  'ci',
  'install',
  'rebuild',
  'remove',
  'run',
  'test',
  'uninstall',
  'update',
])

/** Stable policy error consumed by the Bash tool boundary. */
export class DirectBrowserAccessDeniedError extends Error {
  readonly code = DENIAL_CODE

  constructor() {
    super(DENIAL_MESSAGE)
    this.name = 'DirectBrowserAccessDeniedError'
  }
}

function executableName(value: string): string {
  return value.replaceAll('\\', '/').split('/').at(-1)?.toLowerCase() ?? ''
}

function packageName(value: string): string {
  const normalized = value.toLowerCase()
  const slash = normalized.indexOf('/')
  const version = normalized.lastIndexOf('@')
  if (version > Math.max(0, slash)) return normalized.slice(0, version)
  return normalized
}

interface QuotedHeredoc {
  delimiter: string
  stripTabs: boolean
}

function quotedHeredocs(line: string): QuotedHeredoc[] {
  const heredocs: QuotedHeredoc[] = []
  let quote: '"' | "'" | undefined
  let escaped = false

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index] ?? ''
    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\' && quote !== "'") {
      escaped = true
      continue
    }
    if (quote !== undefined) {
      if (character === quote) quote = undefined
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === '#' && (index === 0 || /[\s;|&]/u.test(line[index - 1] ?? ''))) break
    if (character !== '<' || line[index + 1] !== '<' || line[index + 2] === '<') continue

    let cursor = index + 2
    let stripTabs = false
    if (line[cursor] === '-') {
      stripTabs = true
      cursor += 1
    }
    while (line[cursor] === ' ' || line[cursor] === '\t') cursor += 1
    const delimiterQuote = line[cursor]
    if (delimiterQuote === '"' || delimiterQuote === "'") {
      const end = line.indexOf(delimiterQuote, cursor + 1)
      if (end >= 0) {
        heredocs.push({ delimiter: line.slice(cursor + 1, end), stripTabs })
        index = end
      }
      continue
    }
    if (delimiterQuote === '\\') {
      const match = /^[^\s;|&]+/u.exec(line.slice(cursor + 1))
      if (match?.[0] !== undefined) {
        heredocs.push({ delimiter: match[0], stripTabs })
        index = cursor + match[0].length
      }
    }
  }
  return heredocs
}

function maskQuotedHeredocBodies(source: string): string {
  const output: string[] = []
  const pending: QuotedHeredoc[] = []
  for (const line of source.split(/\r?\n/u)) {
    const active = pending[0]
    if (active !== undefined) {
      const candidate = active.stripTabs ? line.replace(/^\t+/u, '') : line
      if (candidate === active.delimiter) pending.shift()
      output.push('')
      continue
    }
    output.push(line)
    pending.push(...quotedHeredocs(line))
  }
  return output.join('\n')
}

function commandSubstitutions(source: string): string[] {
  const substitutions: string[] = []
  let quote: '"' | "'" | undefined
  let escaped = false

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? ''
    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\' && quote !== "'") {
      escaped = true
      continue
    }
    if (quote === "'") {
      if (character === "'") quote = undefined
      continue
    }
    if (quote === undefined && character === "'") {
      quote = "'"
      continue
    }
    if (character === '"') {
      quote = quote === '"' ? undefined : '"'
      continue
    }
    if (quote === undefined && character === '#'
      && (index === 0 || /[\s;|&(){}]/u.test(source[index - 1] ?? ''))) {
      const newline = source.indexOf('\n', index + 1)
      if (newline < 0) break
      index = newline
      continue
    }
    if (character === '`') {
      let cursor = index + 1
      let innerEscaped = false
      for (; cursor < source.length; cursor += 1) {
        const inner = source[cursor] ?? ''
        if (innerEscaped) innerEscaped = false
        else if (inner === '\\') innerEscaped = true
        else if (inner === '`') break
      }
      if (cursor < source.length) {
        substitutions.push(source.slice(index + 1, cursor))
        index = cursor
      }
      continue
    }
    if (character !== '$' || source[index + 1] !== '(') continue

    let cursor = index + 2
    let depth = 1
    let innerQuote: '"' | "'" | undefined
    let innerEscaped = false
    for (; cursor < source.length && depth > 0; cursor += 1) {
      const inner = source[cursor] ?? ''
      if (innerEscaped) {
        innerEscaped = false
        continue
      }
      if (inner === '\\' && innerQuote !== "'") {
        innerEscaped = true
        continue
      }
      if (innerQuote !== undefined) {
        if (inner === innerQuote) innerQuote = undefined
        continue
      }
      if (inner === '"' || inner === "'") innerQuote = inner
      else if (inner === '(') depth += 1
      else if (inner === ')') depth -= 1
    }
    if (depth === 0) {
      substitutions.push(source.slice(index + 2, cursor - 1))
      index = cursor - 1
    }
  }
  return substitutions
}

/**
 * Split a shell source into simple command token groups. This intentionally is
 * not a shell parser or security boundary; it recognizes the command shapes
 * DSH sends while Docker permissions remain the hard browser boundary.
 */
function shellSegments(source: string): string[][] {
  const segments: string[][] = []
  let segment: string[] = []
  let word = ''
  let quote: '"' | "'" | undefined
  let escaped = false
  let skipLineFeed = false
  let comment = false

  const pushWord = () => {
    if (word !== '') segment.push(word)
    word = ''
  }
  const pushSegment = () => {
    pushWord()
    if (segment.length > 0) segments.push(segment)
    segment = []
  }

  for (const character of maskQuotedHeredocBodies(source)) {
    if (skipLineFeed) {
      skipLineFeed = false
      if (character === '\n') continue
    }
    if (comment) {
      if (character === '\n' || character === '\r') {
        comment = false
        pushSegment()
      }
      continue
    }
    if (escaped) {
      escaped = false
      if (character === '\n') continue
      if (character === '\r') {
        skipLineFeed = true
        continue
      }
      word += character
      continue
    }
    if (character === '\\' && quote !== "'") {
      escaped = true
      continue
    }
    if (quote !== undefined) {
      if (character === quote) quote = undefined
      else word += character
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === '#' && word === '') {
      comment = true
      continue
    }
    if (character === '\n' || character === '\r') {
      pushSegment()
      continue
    }
    if (/\s/u.test(character)) {
      pushWord()
      continue
    }
    if (character === ';' || character === '|' || character === '&'
      || character === '(' || character === ')' || character === '{' || character === '}') {
      pushSegment()
      continue
    }
    word += character
  }
  if (escaped) word += '\\'
  pushSegment()
  return segments
}

function skipOptions(tokens: readonly string[], start: number): number {
  let index = start
  while (tokens[index]?.startsWith('-') === true) index += 1
  return index
}

function unwrapCommand(tokens: readonly string[]): readonly string[] {
  let index = 0
  while (ENVIRONMENT_ASSIGNMENT.test(tokens[index] ?? '')) index += 1

  for (;;) {
    const executable = executableName(tokens[index] ?? '')
    if (executable === 'env') {
      index += 1
      while (index < tokens.length) {
        const token = tokens[index] ?? ''
        if (ENVIRONMENT_ASSIGNMENT.test(token)) index += 1
        else if (token === '-u' || token === '--unset') index += 2
        else if (token.startsWith('-')) index += 1
        else break
      }
      continue
    }
    if (executable === 'command' || executable === 'exec' || executable === 'nohup') {
      index = skipOptions(tokens, index + 1)
      continue
    }
    break
  }

  return tokens.slice(index)
}

function packageRunnerCommand(tokens: readonly string[]): readonly string[] | undefined {
  const executable = executableName(tokens[0] ?? '')
  if (executable === 'npx' || executable === 'bunx') {
    let index = 1
    while (index < tokens.length) {
      const option = tokens[index] ?? ''
      if (option === '--') {
        index += 1
        break
      }
      if (option === '-p' || option === '--package') index += 2
      else if (option.startsWith('-')) index += 1
      else break
    }
    return tokens.slice(index)
  }
  if (executable !== 'npm' && executable !== 'pnpm' && executable !== 'yarn') return undefined

  let actionIndex = 1
  while (tokens[actionIndex]?.startsWith('-') === true) actionIndex += 1
  const action = tokens[actionIndex]?.toLowerCase()
  if (action === undefined || PACKAGE_MANAGER_NON_RUNTIME_ACTIONS.has(action)) return undefined
  let targetIndex = actionIndex
  if (action === 'dlx' || action === 'exec' || action === 'x') targetIndex += 1
  if (tokens[targetIndex] === '--') targetIndex += 1
  targetIndex = skipOptions(tokens, targetIndex)
  return tokens.slice(targetIndex)
}

function isNonRuntimePackageFlow(tokens: readonly string[]): boolean {
  const executable = executableName(tokens[0] ?? '')
  if (executable !== 'npm' && executable !== 'pnpm' && executable !== 'yarn') return false
  let actionIndex = 1
  while (tokens[actionIndex]?.startsWith('-') === true) actionIndex += 1
  return PACKAGE_MANAGER_NON_RUNTIME_ACTIONS.has(tokens[actionIndex]?.toLowerCase() ?? '')
}

function optionPrograms(
  tokens: readonly string[],
  longFlags: readonly string[],
  shortFlags: readonly string[],
): string[] {
  const programs: string[] = []
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index] ?? ''
    if (longFlags.includes(token)) {
      const value = tokens[index + 1]
      if (value !== undefined) programs.push(value)
      index += 1
      continue
    }
    const longFlag = longFlags.find(flag => token.startsWith(`${flag}=`))
    if (longFlag !== undefined) {
      programs.push(token.slice(longFlag.length + 1))
      continue
    }
    if (shortFlags.includes(token)) {
      const value = tokens[index + 1]
      if (value !== undefined) programs.push(value)
      index += 1
      continue
    }
    const shortFlag = shortFlags.find(flag => token.startsWith(flag) && token.length > flag.length)
    if (shortFlag !== undefined) programs.push(token.slice(shortFlag.length).replace(/^=/u, ''))
  }
  return programs
}

function importsBrowserAutomation(source: string): boolean {
  return /(?:\b(?:from|import)\s+['"]?|\b(?:__import__|import|require)\s*\(\s*['"])(?:@playwright\/test|browser[-_]use|chrome-remote-interface|playwright(?:-core)?|puppeteer(?:-core)?|pyppeteer|selenium(?:-webdriver)?)(?:[.'"/\s)]|$)/iu.test(source)
}

function isPlaywrightInstallation(executable: string, action: string | undefined): boolean {
  return /^playwright(?:-core)?$/u.test(executable)
    && (action === 'install' || action === 'install-deps')
}

function shellPrograms(tokens: readonly string[]): string[] {
  const programs: string[] = []
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index] ?? ''
    if (token === '--command') {
      const value = tokens[index + 1]
      if (value !== undefined) programs.push(value)
      continue
    }
    if (token.startsWith('--command=')) {
      programs.push(token.slice('--command='.length))
      continue
    }
    if (!/^-[^-]/u.test(token)) continue
    const commandIndex = token.indexOf('c', 1)
    if (commandIndex < 0) continue
    const attached = token.slice(commandIndex + 1)
    const value = attached === '' ? tokens[index + 1] : attached
    if (value !== undefined) programs.push(value)
  }
  return programs
}

function segmentControlsBrowser(rawTokens: readonly string[], depth: number): boolean {
  let tokens = unwrapCommand(rawTokens)
  let executable = ''
  for (let runnerUnwraps = 0; ; runnerUnwraps += 1) {
    executable = executableName(tokens[0] ?? '')
    const executablePackage = packageName(tokens[0] ?? '')
    if (executable === '') return false
    const directBrowser = DIRECT_BROWSER_EXECUTABLE.test(executable)
      ? executable
      : DIRECT_BROWSER_EXECUTABLE.test(executablePackage) ? executablePackage : undefined
    if (directBrowser !== undefined
      && !isPlaywrightInstallation(directBrowser, tokens[1]?.toLowerCase())) return true

    const runnerCommand = packageRunnerCommand(tokens)
    if (runnerCommand === undefined) break
    if (runnerUnwraps >= MAX_PACKAGE_RUNNER_UNWRAPS) return true
    tokens = unwrapCommand(runnerCommand)
  }

  if (NODE_EXECUTABLE.test(executable)) {
    const preloads = optionPrograms(tokens, ['--import', '--require'], ['-r'])
    if (preloads.some(preload => importsBrowserAutomation(`import '${packageName(preload)}'`))) return true
    const sources = optionPrograms(tokens, ['--eval', '--print'], ['-e', '-p'])
    if (sources.some(importsBrowserAutomation)) return true
  }

  if (PYTHON_EXECUTABLE.test(executable)) {
    const sources = optionPrograms(tokens, [], ['-c'])
    if (sources.some(importsBrowserAutomation)) return true
    const moduleIndex = tokens.indexOf('-m')
    const module = executableName(tokens[moduleIndex + 1] ?? '')
    if (moduleIndex >= 0 && importsBrowserAutomation(`import '${module}'`)
      && !isPlaywrightInstallation(module, tokens[moduleIndex + 2]?.toLowerCase())) return true
  }

  if (depth < 3 && SHELL_EXECUTABLE.test(executable)) {
    if (shellPrograms(tokens).some(nested => commandControlsBrowser(nested, depth + 1))) return true
  }
  if (depth < 3 && executable === 'eval') {
    return commandControlsBrowser(tokens.slice(1).join(' '), depth + 1)
  }

  if (isNonRuntimePackageFlow(tokens)) return false

  if (NETWORK_EXECUTABLES.has(executable) && tokens.slice(1).some(token => CDP_ENDPOINT.test(token))) return true

  return !DOCUMENTATION_EXECUTABLES.has(executable)
    && tokens.slice(1).some(token => REMOTE_CONTROL_ARGUMENT.test(token.toLowerCase()))
}

function commandControlsBrowser(command: string, depth = 0): boolean {
  const executableSource = maskQuotedHeredocBodies(command)
  if (depth < 3 && commandSubstitutions(executableSource)
    .some(source => commandControlsBrowser(source, depth + 1))) return true
  return shellSegments(executableSource).some(segment => segmentControlsBrowser(segment, depth))
}

/** Reject direct browser automation so Agents use the isolated DSH browser tool. */
export function assertBrowserCommandAllowed(command: string): void {
  if (commandControlsBrowser(command)) throw new DirectBrowserAccessDeniedError()
}
