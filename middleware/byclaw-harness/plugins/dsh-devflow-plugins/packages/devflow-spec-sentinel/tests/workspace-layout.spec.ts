// The layout resolver as observable behavior: the union-and-dedupe semantics
// over the detector chain (fixture trees), the null-versus-empty fallback
// contract, scope-id normalization with the 26 real sample-repository names
// as must-not-degrade counterexamples, the manifest-fingerprint cache over
// real temp directories, the never-throw posture, and the published service.
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as Sentinel from '@zhchxiao123/dsh-devflow-spec-sentinel'
import type { EcosystemDetector } from '../src/ecosystem-detectors.ts'
import type { WorkspacePackage } from '../src/types.ts'
import { createWorkspaceLayout, normalizeMember, scopeOf } from '../src/workspace-layout.ts'

const FIXTURES = join(import.meta.dirname, 'fixtures')

let workspace: string | undefined

afterEach(async () => {
  if (workspace !== undefined) await rm(workspace, { recursive: true, force: true })
  workspace = undefined
})

async function tempWorkspace(): Promise<string> {
  workspace = await mkdtemp(join(tmpdir(), 'devflow-layout-'))
  return workspace
}

async function addPackage(root: string, dir: string, name?: string): Promise<string> {
  const packageDir = join(root, dir)
  await mkdir(packageDir, { recursive: true })
  if (name !== undefined) await writeFile(join(packageDir, 'package.json'), JSON.stringify({ name }))
  return packageDir
}

/** A resolver whose warnings are captured through a real logger exporter. */
function resolver(detectors?: readonly EcosystemDetector[]) {
  const ctx = new Context()
  const warnings: string[] = []
  ctx.logger.exporter({
    levels: { default: 3 },
    export: (message) => {
      if (message.type === 'warn') warnings.push(message.args.map(String).join(' '))
    },
  })
  const service = detectors === undefined ? createWorkspaceLayout(ctx) : createWorkspaceLayout(ctx, detectors)
  return { layout: service.layout.bind(service), discover: service.discover!.bind(service), warnings }
}

describe('the detector union', () => {
  it('unions the answers of two ecosystems at one root (the fastapi-template shape)', async () => {
    const root = join(FIXTURES, 'union')
    const { discover, warnings } = resolver()
    expect(await discover(root)).toEqual({
      packages: [
        { dir: join(root, 'backend'), scopeId: 'app' },
        { dir: join(root, 'frontend'), scopeId: 'frontend' },
        { dir: join(root, 'packages/react-email'), scopeId: 'emails' },
      ],
      detectors: ['npm/yarn/bun workspaces', 'uv-workspace'],
    })
    expect(warnings).toEqual([])
  })

  it('deduplicates one (dir, scopeId) claimed by two ecosystems (the petclinic shape)', async () => {
    const root = join(FIXTURES, 'dedupe')
    const { discover } = resolver()
    expect(await discover(root)).toEqual({
      packages: [{ dir: root, scopeId: 'spring-petclinic' }],
      detectors: ['maven', 'gradle-settings'],
    })
  })

  it('keeps two scopes on one directory when their names differ — they are two ecosystem faces', async () => {
    const root = join(FIXTURES, 'multi-root')
    const { discover } = resolver()
    expect((await discover(root)).packages).toEqual([
      { dir: root, scopeId: 'crate-name' },
      { dir: root, scopeId: 'gradle-name' },
    ])
  })

  it('lets an answered pyproject stand alone beside a plain package.json (the open-webui shape)', async () => {
    const root = join(FIXTURES, 'pyproject', 'beside-npm')
    const { discover, warnings } = resolver()
    // The workspace-less package.json is not an answer and, because the
    // pyproject answered, not the fallback either: one scope, one detector.
    expect(await discover(root)).toEqual({
      packages: [{ dir: root, scopeId: 'open-webui' }],
      detectors: ['pyproject'],
    })
    expect(warnings).toEqual([])
  })

  it('maps nested files to the deepest containing member of the union', async () => {
    const root = join(FIXTURES, 'cargo', 'workspace')
    const { layout } = resolver()
    const packages = await layout(root)
    expect(scopeOf(join(root, 'crates/one/src/lib.rs'), packages)).toBe('crate-one')
    expect(scopeOf(join(root, 'README.md'), packages)).toBe('root-crate')
  })
})

describe('the root fallback', () => {
  it('does not run when a detector answered, even with no readable member', async () => {
    const root = join(FIXTURES, 'answered-empty')
    const { discover, warnings } = resolver()
    // The named root package.json is deliberately NOT promoted to a single
    // package here: an answered-but-empty workspace manifest reported as a
    // single package would be the silent coverage cap all over again.
    expect(await discover(root)).toEqual({ packages: [], detectors: ['pnpm-workspace'] })
    expect(warnings).toEqual([])
  })

  it('answers the root package.json as a single package when every detector returned null', async () => {
    const root = join(FIXTURES, 'npm', 'plain')
    const { discover, warnings } = resolver()
    expect(await discover(root)).toEqual({
      packages: [{ dir: root, scopeId: 'solo-pkg' }],
      detectors: [],
    })
    expect(warnings).toEqual([])
  })

  it('resolves a root with neither manifest to an empty layout with a warning per call, never a rejection', async () => {
    const root = await tempWorkspace()
    const { discover, warnings } = resolver()
    await expect(discover(root)).resolves.toEqual({ packages: [], detectors: [] })
    // The warned failure is not cached, so the second call warns again.
    await discover(root)
    expect(warnings).toHaveLength(2)
  })

  it('resolves a nameless single-package root to an empty layout with a warning', async () => {
    const root = await tempWorkspace()
    await writeFile(join(root, 'package.json'), JSON.stringify({ private: true }))
    const { layout, warnings } = resolver()
    await expect(layout(root)).resolves.toEqual([])
    expect(warnings).toHaveLength(1)
  })
})

describe('scope-id normalization', () => {
  const warnSink = (sink: string[]) => (message: string): void => { sink.push(message) }

  // Every scope id the seven sample repositories actually declare
  // (research/expected-scopes.md): all legal, none may be degraded — the
  // multi-segment npm names and the dotted Go domain are the ones an
  // over-strict rule would maul first.
  const REAL_SCOPE_IDS = [
    'excalidraw-app',
    '@excalidraw/common',
    '@excalidraw/element',
    '@excalidraw/excalidraw',
    '@excalidraw/fractional-indexing',
    '@excalidraw/laser-pointer',
    '@excalidraw/math',
    '@excalidraw/utils',
    'with-nextjs',
    'with-script-in-browser',
    'frontend',
    'emails',
    'app',
    'miniflux.app',
    'open-webui',
    'spring-petclinic',
    'spring-petclinic-admin-server',
    'spring-petclinic-api-gateway',
    'spring-petclinic-config-server',
    'spring-petclinic-customers-service',
    'spring-petclinic-discovery-server',
    'spring-petclinic-genai-service',
    'spring-petclinic-vets-service',
    'spring-petclinic-visits-service',
    'vaultwarden',
    'macros',
  ]

  it('passes every real sample-repository name through unchanged', () => {
    const warnings: string[] = []
    // A non-leading underscore is inside the seam's segment alphabet, so the
    // Rust/Python-typical snake_case names must not be degraded either.
    for (const scopeId of [...REAL_SCOPE_IDS, 'proc_macro2', 'snake_case']) {
      const member = { dir: resolve('/ws/somewhere'), scopeId }
      expect(normalizeMember(member, 'test', warnSink(warnings))).toBe(member)
    }
    expect(warnings).toEqual([])
  })

  it.each([
    ['an uppercase name', 'MyApp', '/ws/upper', 'upper'],
    ['an illegal first character', '-bad', '/ws/startdash', 'startdash'],
    ['a dot-led name', '.hidden', '/ws/dotted', 'dotted'],
    ['a leading underscore', '_private', '/ws/under', 'under'],
    ['an empty name', '', '/ws/unnamed', 'unnamed'],
  ])('degrades %s to the directory name with a warning', (_label, scopeId, dir, expected) => {
    const warnings: string[] = []
    expect(normalizeMember({ dir: resolve(dir), scopeId }, 'test', warnSink(warnings)))
      .toEqual({ dir: resolve(dir), scopeId: expected })
    expect(warnings).toEqual([expect.stringContaining(`the directory name "${expected}" stands in`)])
  })

  it('skips the member with a warning when the directory name is illegal too', () => {
    const warnings: string[] = []
    expect(normalizeMember({ dir: resolve('/ws/Bad_Dir'), scopeId: 'Bad Name' }, 'test', warnSink(warnings)))
      .toBeUndefined()
    expect(warnings).toEqual([expect.stringContaining('the package is not in the layout')])
  })

  it('applies through the layout: degrade, keep, and skip in one workspace', async () => {
    const root = join(FIXTURES, 'normalize')
    const { discover, warnings } = resolver()
    expect(await discover(root)).toEqual({
      packages: [
        { dir: join(root, 'pkgs/fine'), scopeId: 'fine-name' },
        { dir: join(root, 'pkgs/snake'), scopeId: 'snake_case' },
        { dir: join(root, 'pkgs/startdash'), scopeId: 'startdash' },
        { dir: join(root, 'pkgs/upper'), scopeId: 'upper' },
      ],
      detectors: ['npm/yarn/bun workspaces'],
    })
    expect(warnings).toEqual([
      expect.stringContaining('"Bad Name"'),
      expect.stringContaining('"-bad"'),
      expect.stringContaining('"MyApp"'),
    ])
  })

  it('degrades the fallback root name to the root directory name', async () => {
    const root = join(FIXTURES, 'root-degrade')
    const { discover, warnings } = resolver()
    expect(await discover(root)).toEqual({
      packages: [{ dir: root, scopeId: 'root-degrade' }],
      detectors: [],
    })
    expect(warnings).toEqual([expect.stringContaining('root-package fallback package name "Bad Name"')])
  })

  it('skips the fallback root when even the directory name is illegal', async () => {
    const root = join(FIXTURES, 'ROOT_skip')
    const { discover, warnings } = resolver()
    expect(await discover(root)).toEqual({ packages: [], detectors: [] })
    expect(warnings).toEqual([expect.stringContaining('neither the root-package fallback package name "Also Bad"')])
  })
})

describe('layout over pnpm manifests', () => {
  it('expands one-level dir/* globs, keyed by each member package.json name', async () => {
    const root = await tempWorkspace()
    await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n')
    const alpha = await addPackage(root, 'packages/alpha', '@scope/alpha')
    const beta = await addPackage(root, 'packages/beta', '@scope/beta')
    // A matched directory without a named manifest — absent, non-object, or
    // nameless — is not a workspace package (pnpm's own semantics), and a
    // plain file never matches.
    await addPackage(root, 'packages/not-a-package')
    const scalar = await addPackage(root, 'packages/scalar-manifest')
    await writeFile(join(scalar, 'package.json'), '"just a string"')
    await writeFile(join(root, 'packages/README.md'), 'not a directory\n')

    const { layout, warnings } = resolver()
    expect(await layout(root)).toEqual([
      { dir: alpha, scopeId: '@scope/alpha' },
      { dir: beta, scopeId: '@scope/beta' },
    ])
    expect(warnings).toEqual([])
  })

  it('includes explicit paths and subtracts negated patterns', async () => {
    const root = await tempWorkspace()
    await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n  - tools/site\n  - "!packages/legacy"\n')
    const alpha = await addPackage(root, 'packages/alpha', '@scope/alpha')
    await addPackage(root, 'packages/legacy', '@scope/legacy')
    const site = await addPackage(root, 'tools/site', '@scope/site')

    const { layout } = resolver()
    expect(await layout(root)).toEqual([
      { dir: alpha, scopeId: '@scope/alpha' },
      { dir: site, scopeId: '@scope/site' },
    ])
  })

  it('warns on an unsupported glob and skips it, keeping the supported rest', async () => {
    const root = await tempWorkspace()
    await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/**\n  - tools/site\n')
    await addPackage(root, 'packages/alpha', '@scope/alpha')
    const site = await addPackage(root, 'tools/site', '@scope/site')

    const { layout, warnings } = resolver()
    expect(await layout(root)).toEqual([{ dir: site, scopeId: '@scope/site' }])
    expect(warnings).toEqual([expect.stringContaining('unsupported workspace glob "packages/**"')])
  })

  it('matches nothing under a glob whose parent directory is absent', async () => {
    const root = await tempWorkspace()
    await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - missing/*\n')
    const { layout, warnings } = resolver()
    expect(await layout(root)).toEqual([])
    expect(warnings).toEqual([])
  })

  it('answers an unreadable packages list as empty-with-warning, still counting the detector as answered', async () => {
    const root = await tempWorkspace()
    await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages: all\n')
    const { discover, warnings } = resolver()
    expect(await discover(root)).toEqual({ packages: [], detectors: ['pnpm-workspace'] })
    expect(warnings).toHaveLength(1)
  })
})

describe('the manifest-fingerprint cache', () => {
  it('serves the cached layout while every governing manifest stands, and recomputes when one moves', async () => {
    const root = await tempWorkspace()
    const manifest = join(root, 'pnpm-workspace.yaml')
    await writeFile(manifest, 'packages:\n  - packages/*\n')
    const alphaManifest = join(await addPackage(root, 'packages/alpha', '@scope/alpha'), 'package.json')

    const { layout } = resolver()
    const first = await layout(root)
    expect(first.map((pkg: WorkspacePackage) => pkg.scopeId)).toEqual(['@scope/alpha'])

    // A member rename without a governing-manifest touch is served stale —
    // the cache is keyed on the governing manifests' mtimes, not the members'.
    await writeFile(alphaManifest, JSON.stringify({ name: '@scope/renamed' }))
    expect(await layout(root)).toBe(first)

    // Touching the manifest invalidates the entry and picks the rename up.
    await utimes(manifest, new Date(), new Date(Date.now() + 5_000))
    expect((await layout(root)).map((pkg: WorkspacePackage) => pkg.scopeId)).toEqual(['@scope/renamed'])
  })

  it('invalidates on a manifest appearing, not only on one changing', async () => {
    const root = await tempWorkspace()
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@scope/solo' }))
    const { discover } = resolver()
    expect((await discover(root)).packages).toEqual([{ dir: resolve(root), scopeId: '@scope/solo' }])

    // A workspace manifest written after the fallback was cached must take
    // over on the next call: absence was part of the recorded state.
    await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages: []\n')
    expect(await discover(root)).toEqual({ packages: [], detectors: ['pnpm-workspace'] })
  })
})

describe('the never-throw posture', () => {
  it('warns and treats a throwing detector as not answering, falling back past it', async () => {
    const root = await tempWorkspace()
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@scope/solo' }))
    const hostile: EcosystemDetector = {
      name: 'hostile',
      manifests: () => [],
      detect: () => Promise.reject(new Error('boom')),
    }
    const { discover, warnings } = resolver([hostile])
    expect(await discover(root)).toEqual({
      packages: [{ dir: resolve(root), scopeId: '@scope/solo' }],
      detectors: [],
    })
    expect(warnings).toEqual([expect.stringContaining('hostile detection failed')])
  })

  it('degrades a resolution blow-up outside the chain to an empty answer with a warning', async () => {
    const exploding: EcosystemDetector = {
      name: 'exploding',
      manifests: () => { throw new Error('kaboom') },
      detect: async () => [],
    }
    const { discover, warnings } = resolver([exploding])
    expect(await discover('/nowhere')).toEqual({ packages: [], detectors: [] })
    expect(warnings).toEqual([expect.stringContaining('workspace layout resolution failed')])
  })
})

describe('scopeOf', () => {
  const layout: WorkspacePackage[] = [
    { dir: resolve('/ws'), scopeId: '@scope/root' },
    { dir: resolve('/ws/packages/alpha'), scopeId: '@scope/alpha' },
  ]

  it('maps a file to the deepest containing package, whatever the layout order', () => {
    expect(scopeOf(resolve('/ws/packages/alpha/src/a.ts'), layout)).toBe('@scope/alpha')
    expect(scopeOf(resolve('/ws/packages/alpha/src/a.ts'), [...layout].reverse())).toBe('@scope/alpha')
    expect(scopeOf(resolve('/ws/docs/guide.md'), layout)).toBe('@scope/root')
  })

  it('never matches on a bare name prefix, only on a path boundary or the directory itself', () => {
    expect(scopeOf(resolve('/ws/packages/alpha-extras/src/a.ts'), layout.slice(1))).toBeUndefined()
    expect(scopeOf(resolve('/ws/packages/alpha'), layout)).toBe('@scope/alpha')
  })

  it('returns undefined outside every package', () => {
    expect(scopeOf(resolve('/elsewhere/a.ts'), layout)).toBeUndefined()
  })
})

describe('the devflowSpecWorkspace service', () => {
  it('is published by the plugin without the spec seam and unwinds with the fiber', async () => {
    const root = await tempWorkspace()
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@scope/solo' }))
    const ctx = new Context()
    const fork = await ctx.plugin(Sentinel, {})
    await new Promise(tick => setTimeout(tick, 0))

    const service = ctx.get('devflowSpecWorkspace')
    expect(service).toBeDefined()
    expect(await service!.layout(root)).toEqual([{ dir: resolve(root), scopeId: '@scope/solo' }])
    // The detector-detail face rides the same service value.
    expect(await service!.discover?.(root)).toEqual({
      packages: [{ dir: resolve(root), scopeId: '@scope/solo' }],
      detectors: [],
    })

    await fork.dispose()
    expect(ctx.get('devflowSpecWorkspace')).toBeUndefined()
  })
})
