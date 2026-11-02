/**
 * Heavy-command classification. Pure, side-effect-free: decide whether a shell
 * command is a build-class workload that should take a concurrency slot, get a
 * bounded `MAKEFLAGS`, and be marked as a preferred OOM victim.
 *
 * The classification is deliberately **head-anchored**, not substring-based.
 * A substring rule (`*make*`) misfires on `echo "make dinner"`, `cat Makefile`,
 * and any path containing a tool name; every one of those would then queue for
 * a build slot and stall behind a real compile. Matching only the executable
 * token the shell actually invokes keeps false positives to commands that
 * genuinely start with a build tool.
 *
 * Three shapes are recognized:
 *
 * 1. **Bare tools** — the first token alone decides (`make`, `ninja`, `gcc`).
 * 2. **Subcommand tools** — the first token is only heavy for specific second
 *    tokens (`cargo build` is heavy, `cargo fmt` is not; `docker build` is
 *    heavy, `docker ps` is not). Classifying the whole tool as heavy would make
 *    every `go vet` wait for a compile slot.
 * 3. **Leading assignments and `env`** — real build invocations are routinely
 *    prefixed with `CC=clang make` or `env RUSTFLAGS=... cargo build`. Those
 *    prefixes are skipped before the tool token is read, because a build that
 *    evades classification is worse than one that is classified late.
 *
 * Commands are inspected only up to the first shell operator. In `make && ls`
 * the head is still `make`, so the command is heavy; in `ls && make` it is not,
 * which is a deliberate, conservative miss — a compound command's later
 * segments are not parsed, and under-classifying merely forgoes the guard
 * rather than corrupting the command.
 *
 * @module @byclaw/dsh-bash-provider/heavy-command
 */

/** Executables that are heavy regardless of their arguments. */
const HEAVY_TOOLS: ReadonlySet<string> = new Set([
  'make',
  'gmake',
  'ninja',
  'cmake',
  'meson',
  'scons',
  'bazel',
  'buck2',
  'gcc',
  'g++',
  'cc',
  'c++',
  'clang',
  'clang++',
  'rustc',
  'javac',
  'kotlinc',
  'swiftc',
  'tsc',
])

/**
 * Executables heavy only for particular subcommands. The value is the set of
 * second tokens that make the invocation a build; every other subcommand of
 * the same tool stays light.
 */
const HEAVY_SUBCOMMANDS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['cargo', new Set(['build', 'test', 'bench', 'check', 'clippy', 'doc', 'install'])],
  ['go', new Set(['build', 'test', 'install', 'generate'])],
  ['docker', new Set(['build', 'buildx'])],
  ['podman', new Set(['build'])],
  ['dotnet', new Set(['build', 'publish', 'test'])],
  ['mvn', new Set(['compile', 'package', 'install', 'test', 'verify'])],
  ['gradle', new Set(['build', 'assemble', 'test'])],
  ['./gradlew', new Set(['build', 'assemble', 'test'])],
  ['swift', new Set(['build', 'test'])],
  ['zig', new Set(['build', 'build-exe', 'build-lib', 'test'])],
])

/** Shell operators that end the leading command of a compound command. */
const OPERATOR = /[|&;<>()]|\n/

/** A leading `NAME=value` environment assignment, which precedes the real tool token. */
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

/**
 * Split the leading command of `command` into bare tokens.
 *
 * Everything from the first shell operator onward is dropped, so only the head
 * of a compound command is classified. Quoting is not interpreted: a quoted
 * token keeps its quotes and therefore never equals a bare tool name, which is
 * the conservative direction (`"make"` reads as not-heavy rather than as
 * `make`).
 *
 * @param command - the raw shell command the model asked to run.
 * @returns the leading command's whitespace-separated tokens, possibly empty.
 */
function leadingTokens(command: string): string[] {
  const operator = command.search(OPERATOR)
  const head = operator === -1 ? command : command.slice(0, operator)
  return head.trim().split(/\s+/).filter(token => token.length > 0)
}

/**
 * Drop leading `NAME=value` assignments and `env` (with its own assignments and
 * flagless options) so the tool token can be read from a prefixed invocation.
 *
 * `env` options that take a separate argument (`-u NAME`, `--unset NAME`) are
 * not modelled; the argument is simply treated as another skippable token when
 * it looks like an assignment and otherwise ends the scan. Ending the scan
 * early only loses the heavy classification, never changes the command.
 *
 * @param tokens - the leading command's tokens.
 * @returns the tokens from the real executable onward.
 */
function stripPrefixes(tokens: readonly string[]): readonly string[] {
  let index = 0
  while (index < tokens.length) {
    const token = tokens[index] as string
    if (ASSIGNMENT.test(token)) {
      index += 1
      continue
    }
    if (token === 'env' || token === '/usr/bin/env') {
      index += 1
      continue
    }
    break
  }
  return tokens.slice(index)
}

/**
 * Reduce an executable token to the name used for matching: strip any directory
 * prefix so `/usr/bin/make` and `./make` match `make`.
 *
 * `./gradlew` is exempt because it is listed under that exact spelling — the
 * wrapper script is conventionally invoked from the project root and has no
 * bare-name equivalent on PATH.
 *
 * @param token - the executable token as written in the command.
 * @returns the lowercased name to match against the tool tables.
 */
function executableName(token: string): string {
  if (token === './gradlew') return token
  const slash = token.lastIndexOf('/')
  return (slash === -1 ? token : token.slice(slash + 1)).toLowerCase()
}

/**
 * Decide whether `command` is a build-class workload.
 *
 * @param command - the raw shell command the model asked to run.
 * @returns true when the leading command invokes a build tool in a build mode.
 */
export function isHeavyCommand(command: string): boolean {
  const tokens = stripPrefixes(leadingTokens(command))
  const head = tokens[0]
  if (head === undefined) return false

  const name = executableName(head)
  if (HEAVY_TOOLS.has(name)) return true

  const subcommands = HEAVY_SUBCOMMANDS.get(name)
  if (subcommands === undefined) return false

  // Skip flags between the tool and its subcommand (`cargo -q build`).
  const subcommand = tokens.slice(1).find(token => !token.startsWith('-'))
  return subcommand !== undefined && subcommands.has(subcommand.toLowerCase())
}
