import { readFile } from 'node:fs/promises'
import { applyEntryPatches, entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { Config as AgentGateConfig } from '@zhchxiao123/dsh-devflow-agent-gate'
import { Config as ArtifactGateConfig } from '@zhchxiao123/dsh-devflow-artifact-gate'

interface BundleManifest {
  dependencies?: Record<string, string>
  dsh?: { bundle?: { patch?: string } }
}

interface BundleEntry {
  id?: string
  name?: string
  disabled?: boolean
  config?: Record<string, unknown>
}

async function repositoryBundle(): Promise<{ manifest: BundleManifest; entries: BundleEntry[] }> {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as BundleManifest
  const patchPath = manifest.dsh?.bundle?.patch
  if (patchPath === undefined) throw new Error('repository package does not declare dsh.bundle.patch')
  const patch = load(
    await readFile(new URL(`../${patchPath}`, import.meta.url), 'utf8'),
    { schema: entryListSchema },
  ) as Parameters<typeof applyEntryPatches>[1]
  return {
    manifest,
    entries: applyEntryPatches([], patch, (message) => { throw new Error(message) }) as BundleEntry[],
  }
}

describe('repository-level Devflow bundle', () => {
  it('composes the complete constrained workflow from the plugin directory Docker discovers', async () => {
    const { manifest, entries } = await repositoryBundle()

    expect(manifest.dependencies?.['@zhchxiao123/dsh-devflow-bundle']).toBe('workspace:^')
    // A row names a package the profile must already carry. devflow-bundle
    // pulls the seventeen it mounts; testenv is outside that bundle, so the
    // row below would name something no install provides without this.
    expect(manifest.dependencies?.['@zhchxiao123/dsh-devflow-testenv']).toBe('workspace:^')
    expect(entries.map(entry => entry.id)).toEqual([
      'devflow',
      'devflow-tool',
      'devflow-guidance',
      'devflow-worktree',
      'testenv',
      'devflow-command',
      'devflow-fs-guard',
      'devflow-spec',
      'devflow-spec-tool',
      'devflow-spec-sentinel',
      'devflow-iron-rules',
      'devflow-artifact-gate',
      'devflow-agent-gate',
      'devflow-gates',
      'devflow-review-gate',
      'devflow-parent-gate',
      'devflow-web',
      'devflow-ui',
    ])

    // Enabling the row is the whole decision this layer makes. The policy the
    // two gates enforce is their own schema default, so a layer carrying it
    // again would be a second place to update — and, for the agent gate's
    // removed fields, a fatal one.
    for (const id of ['devflow-artifact-gate', 'devflow-agent-gate']) {
      const gate = entries.find(entry => entry.id === id)
      expect(gate?.disabled).toBe(false)
      expect(gate?.config).toBeUndefined()
    }
  })

  it('leaves the constrained workflow to the gate packages, which default to it unconfigured', () => {
    // What the two rows above actually compose, read off the real validators
    // an unconfigured mount runs.
    expect(ArtifactGateConfig({})).toMatchObject({
      kinds: {
        'requirements-document': {
          frontmatter: ['card', 'kind', 'title'],
          sections: ['Problem', 'Goals', 'Acceptance Criteria'],
        },
        'design-document': {
          frontmatter: ['card', 'kind', 'title'],
          sections: ['Approach', 'Interfaces', 'Risks'],
        },
        'development-report': {
          frontmatter: ['card', 'kind', 'title'],
          sections: ['Summary', 'Changes', 'Verification'],
        },
        'review-report': {
          frontmatter: ['card', 'kind', 'title'],
          sections: ['Verdict', 'Findings'],
        },
        'test-report': {
          frontmatter: ['card', 'kind', 'title'],
          sections: ['Scope', 'Results', 'Conclusion'],
        },
      },
      edges: {
        'draft->designing': ['requirements-document'],
        'designing->ready': ['requirements-document', 'design-document'],
        'developing->reviewing': ['development-report'],
        'reviewing->testing': ['review-report'],
        'testing->done': ['test-report'],
      },
    })

    expect(AgentGateConfig({})).toMatchObject({
      checkTimeoutMs: 600_000,
      edges: {
        'draft->designing': { provider: 'spawn', inputs: ['requirements-document'] },
        'designing->ready': { provider: 'spawn', inputs: ['requirements-document', 'design-document'] },
        'developing->reviewing': {
          provider: 'spawn',
          inputs: ['requirements-document', 'design-document', 'development-report'],
        },
        'reviewing->testing': {
          provider: 'spawn',
          inputs: ['requirements-document', 'design-document', 'development-report', 'review-report'],
        },
        'testing->done': {
          provider: 'spawn',
          inputs: ['requirements-document', 'design-document', 'development-report', 'review-report', 'test-report'],
        },
      },
    })

    // Every checker edge names kinds the artifact gate requires on the same
    // edge: the mechanical half composes first, so the paid checker never
    // opens on an artifact that was never required.
    const artifactEdges = ArtifactGateConfig({}).edges ?? {}
    const artifactKinds = Object.keys(ArtifactGateConfig({}).kinds ?? {})
    for (const [edge, check] of Object.entries(AgentGateConfig({}).edges ?? {})) {
      expect(artifactEdges).toHaveProperty(edge)
      for (const kind of check.inputs ?? []) expect(artifactKinds).toContain(kind)
    }
  })

  it('states neither removed agent-gate location, in the layer or the default', () => {
    // The gate derives both from the moving card's own devflow root and throws
    // when either is configured.
    expect(AgentGateConfig({})).not.toHaveProperty('reportDir')
    expect(AgentGateConfig({})).not.toHaveProperty('verdictCacheDir')
  })
})
