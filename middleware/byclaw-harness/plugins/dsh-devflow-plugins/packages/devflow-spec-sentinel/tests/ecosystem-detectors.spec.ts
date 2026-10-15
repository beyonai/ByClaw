// Each ecosystem detector as observable behavior over checked-in fixture
// trees: what its supported surface reads, what null-versus-empty means, and
// that everything outside the surface is warned about and skipped rather
// than guessed at. The combiner over these detectors is covered in
// workspace-layout.spec.ts.
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { EcosystemDetector } from '../src/ecosystem-detectors.ts'
import {
  cargoWorkspace,
  composerPackage,
  dotnetProjects,
  goModules,
  gradleSettings,
  mavenModules,
  mixProjects,
  npmWorkspaces,
  packageGlobs,
  pnpmWorkspace,
  pyprojectPackage,
  rubyPackage,
  uvWorkspace,
} from '../src/ecosystem-detectors.ts'

const FIXTURES = join(import.meta.dirname, 'fixtures')

/** Run one detector on a fixture root, capturing its warnings. */
async function detect(detector: EcosystemDetector, ...fixture: string[]) {
  const warnings: string[] = []
  const root = join(FIXTURES, ...fixture)
  const members = await detector.detect(root, message => warnings.push(message))
  return { root, members, warnings }
}

describe('packageGlobs', () => {
  it('reads the packages list, quoted or not, through comments', () => {
    expect(packageGlobs('# workspace\npackages:\n  - packages/*\n  - "tools/site"\n  - \'!packages/legacy\'\nlinkWorkspacePackages: true\n'))
      .toEqual(['packages/*', 'tools/site', '!packages/legacy'])
  })

  it.each([
    ['unparsable yaml', 'packages: [\n'],
    ['a non-mapping document', 'just a scalar'],
    ['a missing packages key', 'linkWorkspacePackages: true\n'],
    ['a packages key that is not a list', 'packages: all\n'],
    ['a list with a non-string entry', 'packages:\n  - packages/*\n  - {}\n'],
  ])('refuses %s whole', (_label, text) => {
    expect(packageGlobs(text)).toBeUndefined()
  })
})

describe('pnpm-workspace', () => {
  it('does not answer without a pnpm-workspace.yaml', async () => {
    const { members, warnings } = await detect(pnpmWorkspace, 'npm', 'plain')
    expect(members).toBeNull()
    expect(warnings).toEqual([])
  })

  it('answers empty, not null, for a manifest with an empty packages list', async () => {
    const { members, warnings } = await detect(pnpmWorkspace, 'answered-empty')
    expect(members).toEqual([])
    expect(warnings).toEqual([])
  })
})

describe('npm/yarn/bun workspaces', () => {
  it('expands the array form, skipping manifest-less and nameless directories', async () => {
    const { root, members, warnings } = await detect(npmWorkspaces, 'npm', 'array-form')
    expect(members).toEqual([
      { dir: join(root, 'app'), scopeId: 'app-pkg' },
      { dir: join(root, 'packages/ui'), scopeId: '@acme/ui' },
    ])
    expect(warnings).toEqual([])
  })

  it('expands the { packages } object form', async () => {
    const { root, members } = await detect(npmWorkspaces, 'npm', 'packages-form')
    expect(members).toEqual([{ dir: join(root, 'libs/a'), scopeId: 'lib-a' }])
  })

  it('does not answer for a package.json without a workspaces field', async () => {
    const { members, warnings } = await detect(npmWorkspaces, 'npm', 'plain')
    expect(members).toBeNull()
    expect(warnings).toEqual([])
  })

  it('does not answer where no package.json exists', async () => {
    const { members } = await detect(npmWorkspaces, 'cargo', 'single')
    expect(members).toBeNull()
  })

  it('refuses a workspaces field outside the two supported shapes, answering empty', async () => {
    const { members, warnings } = await detect(npmWorkspaces, 'npm', 'ill-formed')
    expect(members).toEqual([])
    expect(warnings).toEqual([expect.stringContaining('neither a string list nor')])
  })

  it.each([
    ['unparsable JSON', 'unparsable'],
    ['a null document', 'null-manifest'],
    ['an array document', 'array-manifest'],
  ])('warns on %s and does not answer — it cannot testify either way', async (_label, fixture) => {
    const { members, warnings } = await detect(npmWorkspaces, 'npm', fixture)
    expect(members).toBeNull()
    expect(warnings).toEqual([expect.stringContaining('not a JSON object')])
  })
})

describe('cargo', () => {
  it('unions member globs with the root package, skipping nameless and broken member manifests', async () => {
    const { root, members, warnings } = await detect(cargoWorkspace, 'cargo', 'workspace')
    expect(members).toEqual([
      { dir: join(root, 'crates/one'), scopeId: 'crate-one' },
      { dir: join(root, 'tools/cli'), scopeId: 'cli-tool' },
      { dir: root, scopeId: 'root-crate' },
    ])
    expect(warnings).toEqual([])
  })

  it('reads a virtual workspace, whose root is no member', async () => {
    const { root, members } = await detect(cargoWorkspace, 'cargo', 'virtual')
    expect(members).toEqual([{ dir: join(root, 'm1'), scopeId: 'm-one' }])
  })

  it('reads a plain single crate', async () => {
    const { root, members } = await detect(cargoWorkspace, 'cargo', 'single')
    expect(members).toEqual([{ dir: root, scopeId: 'solo-crate' }])
  })

  it('treats [workspace] without a members list as contributing no members', async () => {
    const { root, members, warnings } = await detect(cargoWorkspace, 'cargo', 'rooted-workspace')
    expect(members).toEqual([{ dir: root, scopeId: 'ws-root' }])
    expect(warnings).toEqual([])
  })

  it('does not answer without a Cargo.toml', async () => {
    const { members } = await detect(cargoWorkspace, 'npm', 'plain')
    expect(members).toBeNull()
  })

  it.each([
    ['a manifest with neither [workspace] nor [package]', 'neither', 'neither [workspace] nor [package]'],
    ['unparsable TOML', 'unparsable', 'not parsable TOML'],
    ['a members value that is not a string list', 'bad-members', 'not a string list'],
  ])('refuses %s whole, answering empty with a warning', async (_label, fixture, message) => {
    const { members, warnings } = await detect(cargoWorkspace, 'cargo', fixture)
    expect(members).toEqual([])
    expect(warnings).toEqual([expect.stringContaining(message)])
  })
})

describe('go', () => {
  it('reads go.work use directives, names members by de-versioned module tails, and warns outside the surface', async () => {
    const { root, members, warnings } = await detect(goModules, 'go', 'work')
    expect(members).toEqual([
      { dir: join(root, 'svc'), scopeId: 'svc' },
      // The /v3 major-version suffix is stripped before the tail is taken.
      { dir: join(root, 'mod-a'), scopeId: 'mod-a' },
      // Quoted use path, quoted module path.
      { dir: join(root, 'mod-b'), scopeId: 'standalone' },
      // ghost/ has no go.mod and is silently not a member.
    ])
    expect(warnings).toEqual([
      expect.stringContaining('unsupported use line "use"'),
      expect.stringContaining('unsupported use line "use (junk on one line)"'),
      expect.stringContaining('unsupported use entry "unterminated'),
      expect.stringContaining('absolute path "/outside/the/root"'),
    ])
  })

  it('reads a single go.mod module, stripping the major-version suffix (the miniflux shape)', async () => {
    const { root, members, warnings } = await detect(goModules, 'go', 'module')
    expect(members).toEqual([{ dir: root, scopeId: 'miniflux.app' }])
    expect(warnings).toEqual([])
  })

  it.each([
    ['without a module line', 'no-module'],
    ['whose module path has an empty tail', 'bad-module'],
  ])('answers empty with a warning for a go.mod %s', async (_label, fixture) => {
    const { members, warnings } = await detect(goModules, 'go', fixture)
    expect(members).toEqual([])
    expect(warnings).toEqual([expect.stringContaining('no readable module line')])
  })

  it('does not answer without go.work or go.mod', async () => {
    const { members } = await detect(goModules, 'npm', 'plain')
    expect(members).toBeNull()
  })
})

describe('uv-workspace', () => {
  it('reads a virtual root: members without any root project (the fastapi-template shape)', async () => {
    const { root, members, warnings } = await detect(uvWorkspace, 'uv', 'virtual-root')
    expect(members).toEqual([
      // Names come from each member pyproject, not the directory.
      { dir: join(root, 'backend'), scopeId: 'app' },
      { dir: join(root, 'libs/util'), scopeId: 'util-lib' },
    ])
    expect(warnings).toEqual([])
  })

  it('adds the root as a member when it carries a [project].name', async () => {
    const { root, members } = await detect(uvWorkspace, 'uv', 'rooted')
    expect(members).toEqual([
      { dir: join(root, 'pkg'), scopeId: 'pkg-member' },
      { dir: root, scopeId: 'rooted-app' },
    ])
  })

  it('subtracts the exclude list from the member globs', async () => {
    const { root, members } = await detect(uvWorkspace, 'uv', 'exclude')
    expect(members).toEqual([{ dir: join(root, 'packages/keep'), scopeId: 'keep-pkg' }])
  })

  it('answers the root alone for a workspace table without a members key', async () => {
    const { root, members, warnings } = await detect(uvWorkspace, 'uv', 'bare')
    expect(members).toEqual([{ dir: root, scopeId: 'bare-root' }])
    expect(warnings).toEqual([])
  })

  it.each([
    ['a plain [project] pyproject', 'plain'],
    ['a pyproject with other tools only', 'other-tool'],
    ['[tool.uv] without a workspace table', 'uv-no-workspace'],
  ])('does not answer for %s — that is not a workspace declaration', async (_label, fixture) => {
    const { members, warnings } = await detect(uvWorkspace, 'uv', fixture)
    expect(members).toBeNull()
    expect(warnings).toEqual([])
  })

  it('does not answer without a pyproject.toml', async () => {
    const { members } = await detect(uvWorkspace, 'npm', 'plain')
    expect(members).toBeNull()
  })

  it('warns on unparsable TOML and does not answer — it cannot testify either way', async () => {
    const { members, warnings } = await detect(uvWorkspace, 'uv', 'unparsable')
    expect(members).toBeNull()
    expect(warnings).toEqual([expect.stringContaining('not parsable TOML')])
  })

  it.each([
    ['members', 'bad-members'],
    ['exclude', 'bad-exclude'],
  ])('refuses a workspace table whose %s is not a string list, answering empty', async (_label, fixture) => {
    const { members, warnings } = await detect(uvWorkspace, 'uv', fixture)
    expect(members).toEqual([])
    expect(warnings).toEqual([expect.stringContaining('not a string list')])
  })
})

describe('maven', () => {
  it('reads modules with artifactIds outside the skipped blocks, parent-first poms included', async () => {
    const { root, members, warnings } = await detect(mavenModules, 'maven', 'multi')
    expect(members).toEqual([
      // mod-a writes <parent> and <dependencies> before its own artifactId.
      { dir: join(root, 'mod-a'), scopeId: 'mod-a-artifact' },
      // mod-b has no artifactId of its own; the directory name stands in.
      { dir: join(root, 'mod-b'), scopeId: 'mod-b' },
      // missing/ and the file-module entry point at no directory; the
      // commented-out and profile-declared modules are never read.
    ])
    expect(warnings).toEqual([
      expect.stringContaining('module "../escape"'),
      expect.stringContaining('module "/absolute"'),
    ])
  })

  it('reads a single-module pom, skipping dependency artifactIds written before the project one', async () => {
    const { root, members, warnings } = await detect(mavenModules, 'maven', 'single')
    expect(members).toEqual([{ dir: root, scopeId: 'solo-app' }])
    expect(warnings).toEqual([])
  })

  it('answers empty with a warning for a pom whose only artifactId sits inside <parent>', async () => {
    const { members, warnings } = await detect(mavenModules, 'maven', 'empty')
    expect(members).toEqual([])
    expect(warnings).toEqual([expect.stringContaining('no artifactId outside its skipped blocks')])
  })

  it('does not answer without a pom.xml', async () => {
    const { members } = await detect(mavenModules, 'npm', 'plain')
    expect(members).toBeNull()
  })
})

describe('gradle-settings', () => {
  it('maps Groovy include paths to directories, rootProject.name prefixing the scope ids', async () => {
    const { root, members, warnings } = await detect(gradleSettings, 'gradle', 'groovy')
    expect(members).toEqual([
      { dir: join(root, 'app'), scopeId: 'demo-root/app' },
      { dir: join(root, 'libs/core'), scopeId: 'demo-root/libs/core' },
      { dir: join(root, 'single'), scopeId: 'demo-root/single' },
    ])
    expect(warnings).toEqual([])
  })

  it('reads the Kotlin DSL call form from settings.gradle.kts', async () => {
    const { root, members } = await detect(gradleSettings, 'gradle', 'kts')
    expect(members).toEqual([
      { dir: join(root, 'app'), scopeId: 'kts-root/app' },
      { dir: join(root, 'lib'), scopeId: 'kts-root/lib' },
    ])
  })

  it('answers the root alone for a name-only settings file (the petclinic shape)', async () => {
    const { root, members, warnings } = await detect(gradleSettings, 'gradle', 'name-only')
    expect(members).toEqual([{ dir: root, scopeId: 'spring-petclinic' }])
    expect(warnings).toEqual([])
  })

  it('builds scope ids without a prefix when rootProject.name is absent', async () => {
    const { root, members } = await detect(gradleSettings, 'gradle', 'no-prefix')
    expect(members).toEqual([{ dir: join(root, 'solo'), scopeId: 'solo' }])
  })

  it('keeps the supported lines and warns on each unsupported one', async () => {
    const { root, members, warnings } = await detect(gradleSettings, 'gradle', 'unsupported')
    expect(members).toEqual([{ dir: join(root, 'ok'), scopeId: 'u-root/ok' }])
    expect(warnings).toEqual([
      expect.stringContaining('rootProject.name outside the literal-string surface'),
      expect.stringContaining('include line "include(subprojects)"'),
      expect.stringContaining('include line "include (:oops"'),
      expect.stringContaining('interpolated project path "${dynamic}"'),
      expect.stringContaining('empty project path ":"'),
    ])
  })

  it('answers empty with a warning for a settings file declaring nothing on the surface', async () => {
    const { members, warnings } = await detect(gradleSettings, 'gradle', 'empty')
    expect(members).toEqual([])
    expect(warnings).toEqual([expect.stringContaining('neither rootProject.name nor an include')])
  })

  it('prefers settings.gradle over settings.gradle.kts when both exist', async () => {
    const { root, members } = await detect(gradleSettings, 'gradle', 'both')
    expect(members).toEqual([{ dir: root, scopeId: 'groovy-wins' }])
  })

  it('does not answer without a settings file', async () => {
    const { members } = await detect(gradleSettings, 'npm', 'plain')
    expect(members).toBeNull()
  })
})

describe('pyproject', () => {
  it('reads [project].name as a single package at the root (the open-webui shape)', async () => {
    const { root, members, warnings } = await detect(pyprojectPackage, 'uv', 'plain')
    expect(members).toEqual([{ dir: root, scopeId: 'plain-pkg' }])
    expect(warnings).toEqual([])
  })

  it('falls back to [tool.poetry].name for a pre-621 Poetry manifest', async () => {
    const { root, members, warnings } = await detect(pyprojectPackage, 'pyproject', 'poetry')
    expect(members).toEqual([{ dir: root, scopeId: 'poetry-pkg' }])
    expect(warnings).toEqual([])
  })

  it('prefers [project].name when both tables carry one', async () => {
    const { root, members } = await detect(pyprojectPackage, 'pyproject', 'both')
    expect(members).toEqual([{ dir: root, scopeId: 'pep621-name' }])
  })

  it.each([
    ['a virtual uv root', 'virtual-root'],
    // Even a root that is its own uv member yields: uv-workspace already
    // answers it, and a second answer would double the detectors list.
    ['a uv workspace whose root carries its own [project]', 'rooted'],
  ])('yields to uv-workspace for %s rather than faking a second scope', async (_label, fixture) => {
    const { members, warnings } = await detect(pyprojectPackage, 'uv', fixture)
    expect(members).toBeNull()
    expect(warnings).toEqual([])
  })

  it('does not answer for a tool-configuration-only pyproject — that declares no package', async () => {
    const { members, warnings } = await detect(pyprojectPackage, 'uv', 'other-tool')
    expect(members).toBeNull()
    expect(warnings).toEqual([])
  })

  it('does not answer without a pyproject.toml', async () => {
    const { members } = await detect(pyprojectPackage, 'npm', 'plain')
    expect(members).toBeNull()
  })

  it('warns on unparsable TOML and does not answer — it cannot testify either way', async () => {
    const { members, warnings } = await detect(pyprojectPackage, 'uv', 'unparsable')
    expect(members).toBeNull()
    expect(warnings).toEqual([expect.stringContaining('not parsable TOML')])
  })

  it('answers empty with a warning for a declared package without a readable name', async () => {
    const { members, warnings } = await detect(pyprojectPackage, 'pyproject', 'nameless')
    expect(members).toEqual([])
    expect(warnings).toEqual([expect.stringContaining('no readable [project].name or [tool.poetry].name')])
  })
})

describe('composer', () => {
  it('takes the package half of a vendor/package name, saying why', async () => {
    const { root, members, warnings } = await detect(composerPackage, 'composer', 'vendor-name')
    expect(members).toEqual([{ dir: root, scopeId: 'widget' }])
    expect(warnings).toEqual([expect.stringContaining('the scope takes the package half "widget"')])
  })

  it('takes a name without a vendor half whole, without a warning', async () => {
    const { root, members, warnings } = await detect(composerPackage, 'composer', 'bare-name')
    expect(members).toEqual([{ dir: root, scopeId: 'widget-app' }])
    expect(warnings).toEqual([])
  })

  it('does not answer for a nameless manifest — dependencies alone name no package', async () => {
    const { members, warnings } = await detect(composerPackage, 'composer', 'nameless')
    expect(members).toBeNull()
    expect(warnings).toEqual([])
  })

  it('answers empty with a warning for a name outside the string shape', async () => {
    const { members, warnings } = await detect(composerPackage, 'composer', 'bad-name')
    expect(members).toEqual([])
    expect(warnings).toEqual([expect.stringContaining('not a non-blank string')])
  })

  it('warns on a manifest that is not a JSON object and does not answer', async () => {
    const { members, warnings } = await detect(composerPackage, 'composer', 'unparsable')
    expect(members).toBeNull()
    expect(warnings).toEqual([expect.stringContaining('not a JSON object')])
  })

  it('does not answer without a composer.json', async () => {
    const { members } = await detect(composerPackage, 'npm', 'plain')
    expect(members).toBeNull()
  })
})

describe('ruby', () => {
  it('answers a Gemfile root as a single package named after its directory', async () => {
    const { root, members, warnings } = await detect(rubyPackage, 'ruby', 'gemfile')
    expect(members).toEqual([{ dir: root, scopeId: 'gemfile' }])
    expect(warnings).toEqual([])
  })

  it('answers a gemspec root the same way, never reading the gemspec', async () => {
    const { root, members } = await detect(rubyPackage, 'ruby', 'gemspec')
    expect(members).toEqual([{ dir: root, scopeId: 'gemspec' }])
  })

  it('does not answer for directories merely wearing the manifest names', async () => {
    const { members, warnings } = await detect(rubyPackage, 'ruby', 'dir-gemspec')
    expect(members).toBeNull()
    expect(warnings).toEqual([])
  })

  it('does not answer without a Gemfile or gemspec', async () => {
    const { members } = await detect(rubyPackage, 'npm', 'plain')
    expect(members).toBeNull()
  })
})

describe('dotnet', () => {
  it('expands .csproj solution entries, skipping folders and escapes, backslashes read as separators', async () => {
    const { root, members, warnings } = await detect(dotnetProjects, 'dotnet', 'sln')
    expect(members).toEqual([
      // A project file beside the solution belongs to the root directory.
      { dir: root, scopeId: 'RootProj' },
      { dir: join(root, 'src/App'), scopeId: 'App' },
      { dir: join(root, 'tools/Tool'), scopeId: 'Tool' },
      // The solution folder and the .shproj declare no member; ghost\ points
      // at no directory and merely appeared in the list.
    ])
    expect(warnings).toEqual([
      expect.stringContaining('project path "..\\outside\\Escape.csproj"'),
      expect.stringContaining('project path "/abs/Abs.csproj"'),
      expect.stringContaining('project path "C:\\abs\\Drive.csproj"'),
    ])
  })

  it('answers each root .csproj as a package named after the project file when no solution exists', async () => {
    const { root, members, warnings } = await detect(dotnetProjects, 'dotnet', 'csproj')
    expect(members).toEqual([{ dir: root, scopeId: 'App' }])
    expect(warnings).toEqual([])
  })

  it('answers empty with a warning for a solution yielding no project on the surface', async () => {
    const { members, warnings } = await detect(dotnetProjects, 'dotnet', 'empty-sln')
    expect(members).toEqual([])
    expect(warnings).toEqual([expect.stringContaining('no .csproj project on the supported surface')])
  })

  it('does not answer for directories merely wearing the manifest names', async () => {
    const { members } = await detect(dotnetProjects, 'dotnet', 'fake-dir')
    expect(members).toBeNull()
  })

  it('does not answer without a solution or project file', async () => {
    const { members } = await detect(dotnetProjects, 'npm', 'plain')
    expect(members).toBeNull()
  })
})

describe('mix', () => {
  it('enumerates umbrella app directories carrying a mix.exs, named after themselves', async () => {
    const { root, members, warnings } = await detect(mixProjects, 'mix', 'umbrella')
    expect(members).toEqual([
      { dir: join(root, 'apps/core'), scopeId: 'core' },
      { dir: join(root, 'apps/web'), scopeId: 'web' },
      // apps/no-manifest has no mix.exs; apps/stray-file is not a directory.
    ])
    expect(warnings).toEqual([])
  })

  it('answers a lone root mix.exs as a single package named after its directory', async () => {
    const { root, members } = await detect(mixProjects, 'mix', 'single')
    expect(members).toEqual([{ dir: root, scopeId: 'single' }])
  })

  it('answers the root when the apps directory yields no member', async () => {
    const { root, members } = await detect(mixProjects, 'mix', 'no-hits')
    expect(members).toEqual([{ dir: root, scopeId: 'no-hits' }])
  })

  it('does not answer for a directory merely wearing the mix.exs name', async () => {
    const { members } = await detect(mixProjects, 'mix', 'fake')
    expect(members).toBeNull()
  })

  it('does not answer without a mix.exs', async () => {
    const { members } = await detect(mixProjects, 'npm', 'plain')
    expect(members).toBeNull()
  })
})
