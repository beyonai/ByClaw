/**
 * Command wrapping for rtk (Rust Token Killer). Pure, side-effect-free
 * decision logic: whether a shell command may be routed through `rtk` and,
 * when it may, the exact `rtk` argv to replace the raw `bash -c` source with.
 * Merged into `@byclaw/dsh-bash-provider` from the standalone
 * `@byclaw/dsh-bash-rtk` plugin (originally `DeepTrial/dsh-bash-rtk`, MIT);
 * `ForwardingSandboxBashExecutor.resolve()` applies it after env forwarding.
 *
 * The policy is conservative on purpose — wrapping is a best-effort token
 * optimization, never a semantic change. Three independent guards, in order:
 *
 * 1. **Complexity**: any shell metacharacter that would survive rtk's
 *    single-command boundary (pipelines, lists, redirections, command
 *    substitution, shell variables) disqualifies the command. Wrapping those
 *    would silently change what runs, so they pass through unchanged.
 * 2. **Whitelist**: only a fixed prefix map of development tools that rtk
 *    actually implements is eligible. The map keys are the *executable* name
 *    the shell invokes; the value is the rtk subcommand name (they differ for
 *    a few tools).
 * 3. **Availability**: when the `rtk` binary is absent the whole transform is
 *    the identity, so a deployment without rtk behaves exactly like the
 *    plain forwarding executor.
 *
 * @module @byclaw/dsh-bash-provider/rtk-wrap
 */

/** Shell metacharacters that change how the first command's output would be consumed. */
const SHELL_METACHARACTER = /[|&;<>`$]/

/** Executable name → rtk subcommand. Keys are lowercase and match the shell's first token. */
const RTK_COMMAND_MAP: Readonly<Record<string, string>> = {
  git: 'git',
  gh: 'gh',
  glab: 'glab',
  gt: 'gt',
  cargo: 'cargo',
  go: 'go',
  'golangci-lint': 'golangci-lint',
  npm: 'npm',
  npx: 'npx',
  pnpm: 'pnpm',
  docker: 'docker',
  kubectl: 'kubectl',
  aws: 'aws',
  ruff: 'ruff',
  pytest: 'pytest',
  mypy: 'mypy',
  uv: 'uv',
  dotnet: 'dotnet',
  jest: 'jest',
  vitest: 'vitest',
  prisma: 'prisma',
  tsc: 'tsc',
  playwright: 'playwright',
  curl: 'curl',
  wget: 'wget',
  grep: 'grep',
  rg: 'rg',
  find: 'find',
  psql: 'psql',
  mvn: 'mvn',
  gradlew: 'gradlew',
  sbt: 'sbt',
  pip: 'pip',
  rspec: 'rspec',
  rubocop: 'rubocop',
  rake: 'rake',
  php: 'php',
  phpunit: 'phpunit',
  phpstan: 'phpstan',
  pint: 'pint',
  pest: 'pest',
  next: 'next',
} as const

/**
 * Extract the first whitespace-delimited token of a shell command. Quotes and
 * leading environment assignments (`FOO=bar cmd`) are not special-cased: such
 * commands fall back to plain `bash -c`, which is the safe default.
 * @param command - the raw shell source.
 * @returns the leading executable token, or undefined when empty.
 */
function firstToken(command: string): string | undefined {
  const trimmed = command.trimStart()
  if (trimmed.length === 0) return undefined
  const end = trimmed.search(/\s/)
  // trimmed is non-empty and starts with a non-whitespace byte, so the token
  // is never empty; the conditional only guards the no-whitespace case.
  return (end === -1 ? trimmed : trimmed.slice(0, end)).toLowerCase()
}

/**
 * Decide whether `command` should be routed through `rtk`, and the argv to use
 * when it should. Returns the original command unchanged for every
 * non-eligible case (complex shell, non-whitelisted tool, or rtk absent).
 *
 * The returned string is handed straight to `bash -c`, so a wrapped result is
 * still executed through the shell and preserves the executor's
 * workdir/timeout/env/exit-code semantics unchanged.
 *
 * @param command - the raw shell command the model asked to run.
 * @param rtkAvailable - whether the `rtk` binary resolved on PATH.
 * @returns the command to execute (possibly wrapped), always non-empty.
 */
export function wrapWithRtk(command: string, rtkAvailable: boolean): string {
  if (!rtkAvailable) return command
  if (SHELL_METACHARACTER.test(command)) return command
  const token = firstToken(command)
  if (token === undefined) return command
  const rtkCommand = RTK_COMMAND_MAP[token]
  if (rtkCommand === undefined) return command
  const rest = command.trimStart().slice(token.length)
  return `rtk ${rtkCommand}${rest}`
}
