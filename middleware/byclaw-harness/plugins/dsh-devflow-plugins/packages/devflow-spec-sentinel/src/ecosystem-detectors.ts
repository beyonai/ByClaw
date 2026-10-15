/**
 * The ecosystem detectors behind the workspace-layout resolver: one per
 * package-manager convention, each reading only text manifests — never
 * executing build code — and answering "which member packages does this
 * ecosystem declare at this root".
 *
 * Every detector distinguishes absence from emptiness: `null` means its
 * governing manifest does not exist (the ecosystem is not present), an empty
 * array means the manifest exists but no member could be read. The combiner
 * in `workspace-layout.ts` unions the non-null answers and only falls back to
 * the repository root when every detector returned `null`.
 *
 * Each detector states its supported surface in its own doc; anything outside
 * a surface is warned about and skipped, never guessed at, so a silently
 * narrowed layout can never misreport coverage. Detectors return raw
 * manifest-declared names — normalization to legal scope ids is the
 * combiner's job.
 * @module @zhchxiao123/dsh-devflow-spec-sentinel/src/ecosystem-detectors
 */

import type { Dirent } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { parse as parseTomlText } from 'smol-toml'
import type { WorkspacePackage } from './types.ts'

/** One ecosystem's manifest reader in the detector chain. */
export interface EcosystemDetector {
  /** The name census wording reports, e.g. `pnpm-workspace`. */
  readonly name: string
  /**
   * Absolute paths of the governing manifests whose mtime-or-absence decides
   * whether a cached layout still stands. Member manifests are deliberately
   * absent: a member renamed without a governing-manifest touch is served
   * stale, because renaming a package is repository surgery, not a per-step
   * event.
   */
  manifests(root: string): readonly string[]
  /**
   * Read the members this ecosystem declares at `root`.
   * @param root - absolute workspace root.
   * @param warn - sink for out-of-surface and ill-formed-manifest warnings.
   * @returns `null` when the governing manifest is absent or cannot testify;
   *   otherwise the members, empty when the manifest exists but no member
   *   could be read.
   */
  detect(root: string, warn: (message: string) => void): Promise<readonly WorkspacePackage[] | null>
}

/**
 * Read one manifest file.
 * @param path - absolute file path.
 * @returns the contents, or `undefined` when the file is absent or unreadable
 *   — for a detector, "this ecosystem does not answer here".
 */
async function tryReadFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    // An absent manifest is the non-answer every detector starts from.
    return undefined
  }
}

/**
 * Parse TOML text.
 * @param text - the manifest contents.
 * @returns the document table, or `undefined` when the text does not parse —
 *   the caller decides whether that is a warning or a non-answer.
 */
function parseToml(text: string): Record<string, unknown> | undefined {
  try {
    return parseTomlText(text)
  } catch {
    // Not TOML; a half-read manifest would misreport the member set.
    return undefined
  }
}

/**
 * Narrow an unknown manifest value to a plain object table.
 * @param value - the candidate value.
 * @returns the value as a record, or `undefined` when it is not one.
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/**
 * Narrow an unknown manifest value to a string list.
 * @param value - the candidate value.
 * @returns the list, or `undefined` on any non-string entry — refused whole,
 *   because a half-read list would misreport the member set.
 */
function asStringList(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((entry): entry is string => typeof entry === 'string') ? value : undefined
}

/**
 * Narrow an unknown manifest value to a usable package name.
 * @param value - the candidate value.
 * @returns the name, or `undefined` when it is not a non-blank string.
 */
function asName(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

/**
 * Expand one glob pattern to candidate directories.
 *
 * Supported surface: an explicit relative path (no `*`), or a one-level
 * directory wildcard ending in `/*` (`packages/*`). `**`, mid-path or bare
 * `*`, and every other glob feature are unsupported and expand to nothing
 * after a warning — a silently narrowed layout would misreport coverage.
 * @param root - absolute workspace root.
 * @param pattern - one pattern, negation already stripped by the caller.
 * @param warn - sink for the unsupported-pattern warning.
 * @returns absolute candidate directories; membership is decided later by
 *   each candidate's own manifest.
 */
async function expandPattern(root: string, pattern: string, warn: (message: string) => void): Promise<string[]> {
  if (pattern.endsWith('/*')) {
    const parent = join(root, pattern.slice(0, -2))
    let entries
    try {
      entries = await readdir(parent, { withFileTypes: true })
    } catch {
      // An absent parent directory matches nothing; pnpm treats it the same way.
      return []
    }
    return entries.filter(entry => entry.isDirectory()).map(entry => join(parent, entry.name))
  }
  if (pattern.includes('*')) {
    warn(`devflow-spec-sentinel: unsupported workspace glob "${pattern}"`
      + ' (only explicit paths and one-level "dir/*" are read); its matches are not in the layout')
    return []
  }
  return [join(root, pattern)]
}

/**
 * Expand a member pattern list, `!`-negated patterns subtracted.
 * @param root - absolute workspace root.
 * @param patterns - the manifest's patterns.
 * @param warn - sink for unsupported-pattern warnings.
 * @returns absolute candidate directories, sorted for a deterministic layout.
 */
async function expandGlobs(root: string, patterns: readonly string[], warn: (message: string) => void): Promise<string[]> {
  const included = new Set<string>()
  const excluded = new Set<string>()
  for (const pattern of patterns) {
    const negated = pattern.startsWith('!')
    const target = negated ? excluded : included
    for (const dir of await expandPattern(root, negated ? pattern.slice(1) : pattern, warn)) target.add(dir)
  }
  return [...included].filter(dir => !excluded.has(dir)).sort()
}

/**
 * Turn candidate directories into members through a per-directory name read.
 * @param dirs - absolute candidate directories.
 * @param nameOf - the ecosystem's member-name reader.
 * @returns the named members. A candidate without a readable name is not a
 *   member (pnpm's own semantics, applied across ecosystems), not a failure.
 */
async function membersOf(dirs: readonly string[], nameOf: (dir: string) => Promise<string | undefined>): Promise<WorkspacePackage[]> {
  const packages: WorkspacePackage[] = []
  for (const dir of dirs) {
    const name = await nameOf(dir)
    if (name !== undefined) packages.push({ dir, scopeId: name })
  }
  return packages
}

/**
 * Read one candidate directory's `package.json` name. Also the combiner's
 * root fallback read, hence exported.
 * @param dir - absolute candidate directory.
 * @returns the name, or `undefined` when the directory has no readable, named
 *   manifest.
 */
export async function packageJsonName(dir: string): Promise<string | undefined> {
  let manifest: unknown
  try {
    manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
  } catch {
    // Unreadable or unparsable manifest: the directory merely matched a glob.
    return undefined
  }
  return asName(asRecord(manifest)?.name)
}

/**
 * Extract the `packages` globs of a `pnpm-workspace.yaml`.
 * @param text - the manifest contents.
 * @returns the glob list, or `undefined` when the manifest does not parse or
 *   its `packages` key is not a list of strings — a half-read manifest would
 *   misreport the member set, so an ill-formed one is refused whole.
 */
export function packageGlobs(text: string): string[] | undefined {
  let manifest: unknown
  try {
    manifest = parseYaml(text)
  } catch {
    // Not YAML at all; the caller warns with the manifest path.
    return undefined
  }
  const record = asRecord(manifest)
  return record === undefined ? undefined : asStringList(record.packages)
}

/**
 * `pnpm-workspace.yaml`. Surface: the `packages` glob list on
 * {@link expandPattern}'s glob surface, with `!` negation; a member is a
 * matched directory carrying a named `package.json`. The file exclusively
 * declares pnpm workspaces, so its presence is always an answer: an
 * ill-formed manifest is refused whole with a warning and answers empty.
 */
export const pnpmWorkspace: EcosystemDetector = {
  name: 'pnpm-workspace',
  manifests: root => [join(root, 'pnpm-workspace.yaml')],
  async detect(root, warn) {
    const manifestPath = join(root, 'pnpm-workspace.yaml')
    const text = await tryReadFile(manifestPath)
    if (text === undefined) return null
    const globs = packageGlobs(text)
    if (globs === undefined) {
      warn(`devflow-spec-sentinel: ${manifestPath} carries no readable "packages" list; its members are not in the layout`)
      return []
    }
    return membersOf(await expandGlobs(root, globs, warn), packageJsonName)
  },
}

/**
 * `package.json` `workspaces` — npm, yarn, and bun declare workspaces in this
 * one shape, so one detector answers for all three (hence the reported name).
 * Surface: the array form and the `{ packages: [...] }` object form, globs as
 * in {@link expandPattern}; a member is a matched directory carrying a named
 * `package.json`. A manifest without a `workspaces` field is not an answer —
 * a plain single package is the combiner's root fallback, not a workspace —
 * and one that is not a JSON object is warned about and also not an answer,
 * because an unreadable file cannot testify either way. A `workspaces` field
 * outside the two supported shapes is refused whole and answers empty.
 */
export const npmWorkspaces: EcosystemDetector = {
  name: 'npm/yarn/bun workspaces',
  manifests: root => [join(root, 'package.json')],
  async detect(root, warn) {
    const manifestPath = join(root, 'package.json')
    const text = await tryReadFile(manifestPath)
    if (text === undefined) return null
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      // Unparsable JSON cannot declare workspaces; warned about below.
      parsed = undefined
    }
    const manifest = asRecord(parsed)
    if (manifest === undefined) {
      warn(`devflow-spec-sentinel: ${manifestPath} is not a JSON object; whether it declares workspaces is unknown`)
      return null
    }
    if (!('workspaces' in manifest)) return null
    const globs = asStringList(manifest.workspaces) ?? asStringList(asRecord(manifest.workspaces)?.packages)
    if (globs === undefined) {
      warn(`devflow-spec-sentinel: ${manifestPath} carries a "workspaces" field that is neither a string list nor`
        + ' { packages: [...] }; its members are not in the layout')
      return []
    }
    return membersOf(await expandGlobs(root, globs, warn), packageJsonName)
  },
}

/**
 * Read one candidate directory's `Cargo.toml` `[package].name`.
 * @param dir - absolute candidate directory.
 * @returns the crate name, or `undefined` when no named manifest is readable.
 */
async function cargoPackageName(dir: string): Promise<string | undefined> {
  const text = await tryReadFile(join(dir, 'Cargo.toml'))
  if (text === undefined) return undefined
  const manifest = parseToml(text)
  return manifest === undefined ? undefined : asName(asRecord(manifest.package)?.name)
}

/**
 * Root `Cargo.toml`. Surface: `[workspace].members` globs (explicit paths and
 * one-level `dir/*`, {@link expandPattern}) expanded to directories whose own
 * `Cargo.toml` carries a `[package].name`, plus the root's own
 * `[package].name` when present — the root-package-and-workspace form.
 * `[workspace]` without a `members` list contributes no members; `exclude`,
 * `default-members`, `workspace.package` name inheritance, and
 * path-dependency auto-membership are not read. A manifest that does not
 * parse, or carries neither `[workspace]` nor `[package]`, or whose `members`
 * is not a string list, is refused whole with a warning and answers empty.
 */
export const cargoWorkspace: EcosystemDetector = {
  name: 'cargo',
  manifests: root => [join(root, 'Cargo.toml')],
  async detect(root, warn) {
    const manifestPath = join(root, 'Cargo.toml')
    const text = await tryReadFile(manifestPath)
    if (text === undefined) return null
    const manifest = parseToml(text)
    if (manifest === undefined) {
      warn(`devflow-spec-sentinel: ${manifestPath} is not parsable TOML; its members are not in the layout`)
      return []
    }
    const workspace = asRecord(manifest.workspace)
    const rootPackage = asRecord(manifest.package)
    if (workspace === undefined && rootPackage === undefined) {
      warn(`devflow-spec-sentinel: ${manifestPath} carries neither [workspace] nor [package]; its members are not in the layout`)
      return []
    }
    const packages: WorkspacePackage[] = []
    if (workspace !== undefined && 'members' in workspace) {
      const globs = asStringList(workspace.members)
      if (globs === undefined) {
        warn(`devflow-spec-sentinel: ${manifestPath} carries a [workspace] members value that is not a string list;`
          + ' its members are not in the layout')
        return []
      }
      packages.push(...await membersOf(await expandGlobs(root, globs, warn), cargoPackageName))
    }
    const rootName = asName(rootPackage?.name)
    if (rootName !== undefined) packages.push({ dir: root, scopeId: rootName })
    return packages
  },
}

/**
 * Derive a scope name from a `go.mod` module path: strip a major-version
 * suffix (`/v2`, `/v3`, …) first, then take the last path segment — naively
 * taking the tail of `miniflux.app/v2` would name the scope `v2`.
 * @param text - the `go.mod` contents.
 * @returns the scope name, or `undefined` without a readable `module` line.
 */
function goModuleScope(text: string): string | undefined {
  for (const raw of text.split('\n')) {
    const line = (raw.split('//')[0] as string).trim()
    const path = /^module\s+("?)(\S+)\1$/.exec(line)?.[2]
    if (path === undefined) continue
    // `split` never yields an empty list, so the tail index always answers.
    const tail = path.replace(/\/v\d+$/, '').split('/').at(-1) as string
    return tail.length === 0 ? undefined : tail
  }
  return undefined
}

/**
 * Read one member directory's `go.mod` scope name.
 * @param dir - absolute member directory.
 * @returns the scope name, or `undefined` without a readable module line.
 */
async function goMemberScope(dir: string): Promise<string | undefined> {
  const text = await tryReadFile(join(dir, 'go.mod'))
  return text === undefined ? undefined : goModuleScope(text)
}

/**
 * Extract the `use` directives of a `go.work` file.
 *
 * Surface: the single-line `use <path>` form and the block form `use (` …
 * `)`, one unquoted or double-quoted path per line, `//` comments stripped.
 * A `use` line outside that grammar is warned about and skipped; the other
 * directives (`go`, `toolchain`, `replace`, …) declare no member and are
 * ignored.
 * @param text - the `go.work` contents.
 * @param path - the manifest path, for warnings.
 * @param warn - sink for out-of-surface warnings.
 * @returns the used paths, as written.
 */
function goWorkUses(text: string, path: string, warn: (message: string) => void): string[] {
  const uses: string[] = []
  let inBlock = false
  const take = (token: string): void => {
    if (token.startsWith('"')) {
      if (token.length >= 2 && token.endsWith('"')) uses.push(token.slice(1, -1))
      else warn(`devflow-spec-sentinel: ${path} carries the unsupported use entry ${token}; it is not in the layout`)
      return
    }
    uses.push(token)
  }
  for (const raw of text.split('\n')) {
    const line = (raw.split('//')[0] as string).trim()
    if (line.length === 0) continue
    if (inBlock) {
      if (line === ')') inBlock = false
      else take(line)
      continue
    }
    if (!/^use\b/.test(line)) continue
    if (/^use\s*\($/.test(line)) {
      inBlock = true
      continue
    }
    const single = /^use\s+(\S.*)$/.exec(line)?.[1]
    if (single === undefined || single.startsWith('(')) {
      warn(`devflow-spec-sentinel: ${path} carries the unsupported use line "${line}"`
        + ' (only "use <path>" and the one-path-per-line block form are read); its members are not in the layout')
      continue
    }
    take(single)
  }
  return uses
}

/**
 * `go.work` / `go.mod`. With a `go.work`, the members are its `use`
 * directives on {@link goWorkUses}'s surface, each named through its own
 * `go.mod` per {@link goModuleScope}; an absolute `use` path escapes the root
 * and is warned about and skipped. Without a `go.work`, a root `go.mod`
 * answers as a single module at the root; one with no readable `module` line
 * is warned about and answers empty.
 */
export const goModules: EcosystemDetector = {
  name: 'go',
  manifests: root => [join(root, 'go.work'), join(root, 'go.mod')],
  async detect(root, warn) {
    const workPath = join(root, 'go.work')
    const work = await tryReadFile(workPath)
    if (work !== undefined) {
      const dirs: string[] = []
      for (const use of goWorkUses(work, workPath, warn)) {
        if (isAbsolute(use)) {
          warn(`devflow-spec-sentinel: ${workPath} uses the absolute path "${use}", which escapes the workspace root;`
            + ' it is not in the layout')
          continue
        }
        dirs.push(join(root, use))
      }
      return membersOf(dirs, goMemberScope)
    }
    const modPath = join(root, 'go.mod')
    const mod = await tryReadFile(modPath)
    if (mod === undefined) return null
    const name = goModuleScope(mod)
    if (name === undefined) {
      warn(`devflow-spec-sentinel: ${modPath} carries no readable module line; the module is not in the layout`)
      return []
    }
    return [{ dir: root, scopeId: name }]
  },
}

/**
 * Read one candidate directory's `pyproject.toml` `[project].name`.
 * @param dir - absolute candidate directory.
 * @returns the project name, or `undefined` when no named manifest is readable.
 */
async function pyprojectName(dir: string): Promise<string | undefined> {
  const text = await tryReadFile(join(dir, 'pyproject.toml'))
  if (text === undefined) return undefined
  const manifest = parseToml(text)
  return manifest === undefined ? undefined : asName(asRecord(manifest.project)?.name)
}

/**
 * `pyproject.toml` `[tool.uv.workspace]`. Surface: the `members` globs and
 * the `exclude` list ({@link expandPattern}'s glob surface); a member is a
 * matched directory whose own pyproject carries a `[project].name`. The root
 * `[project]` is deliberately optional — a virtual root declaring only
 * `[tool.uv.workspace]` is a workspace whose root is not itself a member;
 * when the root does carry a `[project].name`, the root is a member too. A
 * pyproject without `[tool.uv.workspace]` is not an answer — a plain Python
 * package is a single-package ecosystem, not a workspace — and one that does
 * not parse is warned about and also not an answer. A workspace table whose
 * `members` or `exclude` is not a string list is refused whole and answers
 * empty.
 */
export const uvWorkspace: EcosystemDetector = {
  name: 'uv-workspace',
  manifests: root => [join(root, 'pyproject.toml')],
  async detect(root, warn) {
    const manifestPath = join(root, 'pyproject.toml')
    const text = await tryReadFile(manifestPath)
    if (text === undefined) return null
    const manifest = parseToml(text)
    if (manifest === undefined) {
      warn(`devflow-spec-sentinel: ${manifestPath} is not parsable TOML; whether it declares a uv workspace is unknown`)
      return null
    }
    const workspace = asRecord(asRecord(asRecord(manifest.tool)?.uv)?.workspace)
    if (workspace === undefined) return null
    const members = 'members' in workspace ? asStringList(workspace.members) : []
    const exclude = 'exclude' in workspace ? asStringList(workspace.exclude) : []
    if (members === undefined || exclude === undefined) {
      warn(`devflow-spec-sentinel: ${manifestPath} carries a [tool.uv.workspace] whose members/exclude is not a string list;`
        + ' its members are not in the layout')
      return []
    }
    const dirs = await expandGlobs(root, [...members, ...exclude.map(pattern => `!${pattern}`)], warn)
    const packages = await membersOf(dirs, pyprojectName)
    const rootName = asName(asRecord(manifest.project)?.name)
    if (rootName !== undefined) packages.push({ dir: root, scopeId: rootName })
    return packages
  },
}

/**
 * The pom blocks whose contents are skipped whole: their `<artifactId>` and
 * `<module>` elements name other artifacts, not this project's own
 * coordinates or member set.
 */
const POM_SKIPPED_BLOCKS = ['parent', 'dependencies', 'dependencyManagement', 'build', 'reporting', 'profiles'] as const

/** What one pom declares on the supported surface. */
interface PomFacts {
  /** The project's own artifactId, or `undefined` when none is readable. */
  readonly artifactId: string | undefined
  /** The `<modules>` entries, in manifest order. */
  readonly modules: readonly string[]
}

/**
 * Scan one pom by line grammar: strip XML comments, drop the
 * {@link POM_SKIPPED_BLOCKS} whole, then take the first remaining
 * `<artifactId>` and every remaining `<module>`.
 * @param text - the pom contents.
 * @returns the artifactId and modules on the supported surface.
 */
function scanPom(text: string): PomFacts {
  let body = text.replace(/<!--[\s\S]*?-->/g, '')
  for (const block of POM_SKIPPED_BLOCKS) {
    body = body.replace(new RegExp(`<${block}[\\s>][\\s\\S]*?</${block}\\s*>`, 'g'), '')
  }
  const idMatch = /<artifactId\s*>([^<]*)<\/artifactId\s*>/.exec(body)
  const artifactId = idMatch === null ? undefined : asName((idMatch[1] as string).trim())
  const modules = [...body.matchAll(/<module\s*>([^<]*)<\/module\s*>/g)]
    .map(match => (match[1] as string).trim())
    .filter(module => module.length > 0)
  return { artifactId, modules }
}

/**
 * Name a module directory after itself, provided it exists.
 * @param dir - absolute module directory.
 * @returns the directory's base name, or `undefined` when the path is not a
 *   directory — a listed module without a directory has no home for documents.
 */
async function directoryName(dir: string): Promise<string | undefined> {
  try {
    return (await stat(dir)).isDirectory() ? basename(dir) : undefined
  } catch {
    // The module points nowhere; it merely appeared in the list.
    return undefined
  }
}

/**
 * `pom.xml`, by line grammar rather than an XML parser this package would
 * carry for two element names. Surface: the `<module>` entries and the
 * project's own `<artifactId>`, read after stripping XML comments and the
 * {@link POM_SKIPPED_BLOCKS} — `<parent>` in particular, because element
 * order is unconstrained and a parent's coordinates before the project's own
 * would otherwise be taken for them; profile-activated modules and parent
 * inheritance are not evaluated. With modules, the members are the module
 * directories, each named by its own pom's artifactId on the same surface,
 * the directory name standing in when that cannot be read; the aggregator
 * root is not a member, and a module path escaping the root is warned about
 * and skipped. Without modules, the root artifactId answers as a single
 * package; a pom carrying neither is warned about and answers empty.
 */
export const mavenModules: EcosystemDetector = {
  name: 'maven',
  manifests: root => [join(root, 'pom.xml')],
  async detect(root, warn) {
    const manifestPath = join(root, 'pom.xml')
    const text = await tryReadFile(manifestPath)
    if (text === undefined) return null
    const { artifactId, modules } = scanPom(text)
    if (modules.length === 0) {
      if (artifactId === undefined) {
        warn(`devflow-spec-sentinel: ${manifestPath} carries no artifactId outside its skipped blocks and no modules;`
          + ' the project is not in the layout')
        return []
      }
      return [{ dir: root, scopeId: artifactId }]
    }
    const packages: WorkspacePackage[] = []
    for (const module of modules) {
      if (isAbsolute(module) || module.split('/').includes('..')) {
        warn(`devflow-spec-sentinel: ${manifestPath} lists the module "${module}", which escapes the workspace root;`
          + ' it is not in the layout')
        continue
      }
      const dir = join(root, module)
      const memberPom = await tryReadFile(join(dir, 'pom.xml'))
      const scopeId = (memberPom === undefined ? undefined : scanPom(memberPom).artifactId) ?? await directoryName(dir)
      if (scopeId !== undefined) packages.push({ dir, scopeId })
    }
    return packages
  },
}

/** The `include` argument surface: comma-separated string literals. */
const GRADLE_INCLUDE_ARGS = /^(['"])[^'"]*\1(\s*,\s*(['"])[^'"]*\3)*$/

/**
 * `settings.gradle` / `settings.gradle.kts` (the Groovy file wins when both
 * exist, Gradle's own precedence), by line grammar — a settings script is
 * code, and this detector never executes code. Surface:
 * `rootProject.name = '<literal>'`, and `include` lines whose arguments are
 * comma-separated string literals, parenthesized or not (`include ':a', ':b'`,
 * `include(":a", ":b")`); a project path `:a:b` maps to the directory `a/b`,
 * and `rootProject.name` prefixes each member's scope id as a leading
 * segment. A `rootProject.name` assignment or `include` line outside that
 * grammar — variables, interpolation, chained Kotlin calls — is warned about
 * and skipped; full-line `//` comments are stripped, and everything else a
 * settings script can do (`includeBuild`, `includeFlat`, plugin management,
 * …) declares no member here. With no include on the surface,
 * `rootProject.name` answers as a single package at the root; a settings
 * file yielding neither is warned about and answers empty.
 */
export const gradleSettings: EcosystemDetector = {
  name: 'gradle-settings',
  manifests: root => [join(root, 'settings.gradle'), join(root, 'settings.gradle.kts')],
  async detect(root, warn) {
    let manifestPath = join(root, 'settings.gradle')
    let text = await tryReadFile(manifestPath)
    if (text === undefined) {
      manifestPath = join(root, 'settings.gradle.kts')
      text = await tryReadFile(manifestPath)
    }
    if (text === undefined) return null

    let rootName: string | undefined
    const projectPaths: string[] = []
    for (const raw of text.split('\n')) {
      const line = raw.trim()
      if (line.startsWith('//')) continue
      if (/^rootProject\.name\s*=/.test(line)) {
        const name = /^rootProject\.name\s*=\s*(['"])([^'"]+)\1$/.exec(line)?.[2]
        if (name === undefined) {
          warn(`devflow-spec-sentinel: ${manifestPath} assigns rootProject.name outside the literal-string surface`
            + ` ("${line}"); the name is not read`)
          continue
        }
        rootName = name
        continue
      }
      if (!/^include[\s(]/.test(line)) continue
      const args = /^include\s*\(\s*(.*?)\s*\)\s*$/.exec(line)?.[1] ?? /^include\s+([^()]*)$/.exec(line)?.[1]
      if (args === undefined || !GRADLE_INCLUDE_ARGS.test(args)) {
        warn(`devflow-spec-sentinel: ${manifestPath} carries the unsupported include line "${line}"`
          + ' (only comma-separated string literals are read); its projects are not in the layout')
        continue
      }
      // The args grammar just proved at least one string literal is present.
      for (const quoted of args.match(/(['"])[^'"]*\1/g) as string[]) projectPaths.push(quoted.slice(1, -1))
    }

    const packages: WorkspacePackage[] = []
    for (const path of projectPaths) {
      if (path.includes('$')) {
        warn(`devflow-spec-sentinel: ${manifestPath} includes the interpolated project path "${path}"; it is not in the layout`)
        continue
      }
      const segments = path.split(':').filter(segment => segment.length > 0)
      if (segments.length === 0) {
        warn(`devflow-spec-sentinel: ${manifestPath} includes the empty project path "${path}"; it is not in the layout`)
        continue
      }
      packages.push({
        dir: join(root, ...segments),
        scopeId: [...rootName === undefined ? [] : [rootName], ...segments].join('/'),
      })
    }
    if (packages.length > 0) return packages
    if (rootName !== undefined) return [{ dir: root, scopeId: rootName }]
    warn(`devflow-spec-sentinel: ${manifestPath} yields neither rootProject.name nor an include on the supported surface;`
      + ' nothing is in the layout')
    return []
  },
}

/**
 * Observe whether a path is an existing regular file.
 * @param path - absolute path.
 * @returns `true` for a file; `false` for absence or any non-file — a
 *   directory wearing a manifest's name is not a manifest.
 */
async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    // Absence is the non-answer every existence probe starts from.
    return false
  }
}

/**
 * List one directory's entries.
 * @param path - absolute directory path.
 * @returns the entries, empty when the directory is absent or unreadable —
 *   nothing to enumerate is an answer, not an error.
 */
async function listDirents(path: string): Promise<Dirent[]> {
  try {
    return await readdir(path, { withFileTypes: true })
  } catch {
    // An absent directory holds no manifests.
    return []
  }
}

/**
 * The root's regular files carrying one suffix, sorted for determinism.
 * @param root - absolute workspace root.
 * @param suffix - the filename suffix, extension dot included.
 * @returns the matching file names.
 */
async function rootFilesEndingWith(root: string, suffix: string): Promise<string[]> {
  return (await listDirents(root))
    .filter(entry => entry.isFile() && entry.name.endsWith(suffix))
    .map(entry => entry.name)
    .sort()
}

/**
 * `pyproject.toml` as a single-package manifest. Surface: `[project].name`
 * (PEP 621), falling back to `[tool.poetry].name` for pre-621 Poetry
 * manifests; the answer is one package at the root. A pyproject carrying
 * `[tool.uv.workspace]` is not an answer here — the uv-workspace detector
 * reads the same file, and answering its possibly-virtual root as a single
 * package besides would put a second scope on the same directory that no
 * manifest declares. A pyproject with neither `[project]` nor `[tool.poetry]`
 * is tool configuration, not a package declaration, and is not an answer;
 * one that does not parse is warned about and also not an answer. A declared
 * package whose name cannot be read is warned about and answers empty.
 */
export const pyprojectPackage: EcosystemDetector = {
  name: 'pyproject',
  manifests: root => [join(root, 'pyproject.toml')],
  async detect(root, warn) {
    const manifestPath = join(root, 'pyproject.toml')
    const text = await tryReadFile(manifestPath)
    if (text === undefined) return null
    const manifest = parseToml(text)
    if (manifest === undefined) {
      warn(`devflow-spec-sentinel: ${manifestPath} is not parsable TOML; whether it declares a Python package is unknown`)
      return null
    }
    if (asRecord(asRecord(asRecord(manifest.tool)?.uv)?.workspace) !== undefined) return null
    const project = asRecord(manifest.project)
    const poetry = asRecord(asRecord(manifest.tool)?.poetry)
    if (project === undefined && poetry === undefined) return null
    const name = asName(project?.name) ?? asName(poetry?.name)
    if (name === undefined) {
      warn(`devflow-spec-sentinel: ${manifestPath} declares a package but no readable [project].name or [tool.poetry].name;`
        + ' the package is not in the layout')
      return []
    }
    return [{ dir: root, scopeId: name }]
  },
}

/**
 * `composer.json`. Surface: the manifest's `name` in Composer's
 * `vendor/package` shape; the scope takes the package half with a warning,
 * because `/` separates scope-id segments and keeping the vendor half would
 * spread one package's documents across a two-segment scope no other surface
 * uses. A name without a `/` is taken whole. A manifest without a `name` is
 * not an answer — Composer lets a root manifest declare dependencies alone,
 * which names no package — and one that is not a JSON object is warned about
 * and also not an answer. A `name` that is not a non-blank string is warned
 * about and answers empty.
 */
export const composerPackage: EcosystemDetector = {
  name: 'composer',
  manifests: root => [join(root, 'composer.json')],
  async detect(root, warn) {
    const manifestPath = join(root, 'composer.json')
    const text = await tryReadFile(manifestPath)
    if (text === undefined) return null
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      // Unparsable JSON cannot name a package; warned about below.
      parsed = undefined
    }
    const manifest = asRecord(parsed)
    if (manifest === undefined) {
      warn(`devflow-spec-sentinel: ${manifestPath} is not a JSON object; whether it names a package is unknown`)
      return null
    }
    if (!('name' in manifest)) return null
    const name = asName(manifest.name)
    if (name === undefined) {
      warn(`devflow-spec-sentinel: ${manifestPath} carries a name that is not a non-blank string; the package is not in the layout`)
      return []
    }
    const slash = name.lastIndexOf('/')
    if (slash === -1) return [{ dir: root, scopeId: name }]
    const packageHalf = name.slice(slash + 1)
    warn(`devflow-spec-sentinel: ${manifestPath} names "${name}"; the scope takes the package half "${packageHalf}",`
      + ' because "/" separates scope-id segments')
    return [{ dir: root, scopeId: packageHalf }]
  },
}

/**
 * Root `*.gemspec` / `Gemfile`. Either file marks the root as one Ruby
 * package named after its directory: a gemspec is Ruby code and this detector
 * never executes code, so the name written inside it is deliberately not
 * read, and a Gemfile names nothing at all. `manifests` lists the root
 * directory itself in the gemspec's stead — the gemspec's filename is not
 * knowable without listing the directory, and the directory's own mtime moves
 * whenever one appears or vanishes; unrelated entry churn over-invalidates,
 * which costs a recompute, never a stale answer.
 */
export const rubyPackage: EcosystemDetector = {
  name: 'ruby',
  manifests: root => [join(root, 'Gemfile'), root],
  async detect(root) {
    const present = await isFile(join(root, 'Gemfile'))
      || (await rootFilesEndingWith(root, '.gemspec')).length > 0
    return present ? [{ dir: root, scopeId: basename(root) }] : null
  },
}

/** The solution `Project` line surface: type GUID, name, then path. */
const SLN_PROJECT_LINE = /^Project\("[^"]*"\)\s*=\s*"([^"]*)"\s*,\s*"([^"]*)"/

/**
 * `*.sln`, else root `*.csproj`, by line grammar. Surface: every root
 * solution file's `Project("<type>") = "<name>", "<path>"` lines whose path
 * ends in `.csproj` — solution folders and the other project types declare no
 * member here — each member being the project file's directory (backslashes
 * read as separators) under its solution-declared name; a path escaping the
 * root, absolute or drive-lettered, is warned about and skipped, and one
 * pointing at no directory merely appeared in the list. Solution files that
 * yield no member on that surface are warned about and answer empty. Without
 * a solution file, each root `*.csproj` answers as a package at the root
 * named after the project file. Like the ruby detector, `manifests` lists the
 * root directory itself, because the solution and project filenames are not
 * knowable without listing it.
 */
export const dotnetProjects: EcosystemDetector = {
  name: 'dotnet',
  manifests: root => [root],
  async detect(root, warn) {
    const slnNames = await rootFilesEndingWith(root, '.sln')
    if (slnNames.length === 0) {
      const csprojNames = await rootFilesEndingWith(root, '.csproj')
      if (csprojNames.length === 0) return null
      return csprojNames.map(name => ({ dir: root, scopeId: name.slice(0, -'.csproj'.length) }))
    }
    const packages: WorkspacePackage[] = []
    for (const slnName of slnNames) {
      const slnPath = join(root, slnName)
      // The file was just listed at the root; a read failure here is the
      // chain's warn-and-skip detector-error path, not a surface case.
      const text = await readFile(slnPath, 'utf8')
      for (const raw of text.split('\n')) {
        const match = SLN_PROJECT_LINE.exec(raw.trim())
        if (match === null) continue
        const [, scopeId, rawPath] = match as unknown as [string, string, string]
        const path = rawPath.replaceAll('\\', '/')
        if (!path.endsWith('.csproj')) continue
        if (isAbsolute(path) || /^[A-Za-z]:/.test(path) || path.split('/').includes('..')) {
          warn(`devflow-spec-sentinel: ${slnPath} lists the project path "${rawPath}", which escapes the workspace root;`
            + ' it is not in the layout')
          continue
        }
        const dir = join(root, dirname(path))
        if (await directoryName(dir) !== undefined) packages.push({ dir, scopeId })
      }
    }
    if (packages.length === 0) {
      warn(`devflow-spec-sentinel: the solution file(s) at ${root} yield no .csproj project on the supported surface;`
        + ' nothing is in the layout')
    }
    return packages
  },
}

/**
 * Root `mix.exs`. Surface: existence only — a mix file is Elixir code and is
 * never parsed, so every name is a directory name. With umbrella members
 * (`apps/<dir>/mix.exs`), the members are those app directories; without any,
 * the root answers as a single package named after its own directory. The
 * `apps` directory rides `manifests` so a member appearing or vanishing
 * invalidates the cached layout; a mix file changing inside an existing app
 * directory does not, and does not need to — membership is the only fact read.
 */
export const mixProjects: EcosystemDetector = {
  name: 'mix',
  manifests: root => [join(root, 'mix.exs'), join(root, 'apps')],
  async detect(root) {
    if (!await isFile(join(root, 'mix.exs'))) return null
    const members: WorkspacePackage[] = []
    const apps = (await listDirents(join(root, 'apps')))
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort()
    for (const app of apps) {
      const dir = join(root, 'apps', app)
      if (await isFile(join(dir, 'mix.exs'))) members.push({ dir, scopeId: app })
    }
    return members.length > 0 ? members : [{ dir: root, scopeId: basename(root) }]
  },
}

/** The detector chain, in the order their names appear in a discovery answer. */
export const DETECTORS: readonly EcosystemDetector[] = [
  pnpmWorkspace,
  npmWorkspaces,
  cargoWorkspace,
  goModules,
  uvWorkspace,
  mavenModules,
  gradleSettings,
  pyprojectPackage,
  composerPackage,
  rubyPackage,
  dotnetProjects,
  mixProjects,
]
