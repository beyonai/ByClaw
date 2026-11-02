// A package is mounted by `devflow-bundle` XOR it ships its own
// `cordis.patch.yml`, never both — enforced here against the real patch
// algorithm rather than by reading the rule off a document.
//
// The failure it prevents is total, not partial. `dsh plugin add` appends
// every dependency that declares `dsh.bundle` to the profile's
// `dsh.profile.bundles`, and `applyEntryPatches` appends each layer's `insert`
// rows with no deduplication by id. A profile holding the bundle and a package
// that also patches itself therefore composes two rows of one id, and the
// Loader refuses the whole composition with `duplicate loader entry id` —
// a profile that no longer boots, from two installs that each worked alone.
//
// Nothing else in this repository composes more than one bundle layer, which
// is why the rule held for four packages by accident and broke the moment one
// of them was adopted.
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { applyEntryPatches } from '@deepseek-ai/cordis-plugin-include'
import { parsePatchYaml } from './patch-yaml.ts'

const PACKAGES = new URL('../packages/', import.meta.url)

/** One package's bundle patch, as the profile loader would read it. */
interface Carrier {
  /** The package directory name, used as the diagnostic label. */
  readonly label: string
  /** The patch list the layer contributes. */
  readonly patches: NonNullable<Parameters<typeof applyEntryPatches>[1]>
}

/**
 * Every `packages/*\/cordis.patch.yml`, in directory order. A package without
 * one contributes no layer and cannot collide with anything.
 */
function carriers(): Carrier[] {
  const found: Carrier[] = []
  for (const label of readdirSync(PACKAGES).sort()) {
    let source: string
    try {
      source = readFileSync(new URL(`${label}/cordis.patch.yml`, PACKAGES), 'utf8')
    } catch {
      // The ordinary case: most packages are mounted by the bundle and carry
      // no patch of their own.
      continue
    }
    // A repository-owned file, and the shape `applyEntryPatches` itself
    // trusts: the harness validates a patch document at mount, not here.
    found.push({ label, patches: parsePatchYaml(source) as Carrier['patches'] })
  }
  return found
}

/** Which carrier contributes each row id, in application order. */
function idsByCarrier(layers: readonly Carrier[]): Map<string, string[]> {
  const origin = new Map<string, string[]>()
  for (const layer of layers) {
    const before = applyEntryPatches([], structuredClone([...layer.patches]), () => {})
    for (const entry of before) {
      const id = String(entry.id)
      origin.set(id, [...origin.get(id) ?? [], layer.label])
    }
  }
  return origin
}

describe('bundle row ids across every patch layer', () => {
  const layers = carriers()

  it('finds the patch carriers at all, so an empty sweep cannot pass vacuously', () => {
    expect(layers.map(layer => layer.label)).toContain('devflow-bundle')
    expect(layers.length).toBeGreaterThan(1)
  })

  it('composes every carrier into one profile without a duplicate row id', () => {
    const origin = idsByCarrier(layers)
    const collisions = [...origin]
      .filter(([, sources]) => sources.length > 1)
      .map(([id, sources]) => `${id} (inserted by ${sources.join(' and ')})`)
    // A package belongs to one of these lists, never both: adopting it into
    // the bundle means deleting its own patch in the same change.
    expect(collisions).toEqual([])

    // The same statement through the algorithm itself, so the check cannot
    // pass because the accounting above drifted from what actually composes.
    const composed = applyEntryPatches([], structuredClone(layers.flatMap(layer => [...layer.patches])), () => {})
    const ids = composed.map(entry => String(entry.id))
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([])
  })

  it('names every package whose patch the repository still ships', () => {
    // A carrier joining or leaving this list is the decision the rule above
    // governs; it moves here in the same change, with the reason in its patch.
    // Upstream also carries devflow-deploy and devflow-midscene here. ByClaw
    // does not package either (see UPSTREAM.md), so neither ships a layer.
    expect(layers.map(layer => layer.label)).toEqual([
      'devflow-bundle',
      'devflow-testenv',
    ])
  })
})
