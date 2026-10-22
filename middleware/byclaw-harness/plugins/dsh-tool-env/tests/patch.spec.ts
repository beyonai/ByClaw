import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { load, Type, DEFAULT_SCHEMA } from 'js-yaml'

// The profile patch's `!!js` scalars are expressions; evaluate the `disabled` ones
// the way the Loader would, against a given environment.
const jsType = new Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: (source: string) => ({ js: source }) })
const schema = DEFAULT_SCHEMA.extend([jsType])

interface Row { id?: string; name?: string; disabled?: { js: string } | boolean; insert?: Row[] }

async function rows(): Promise<Row[]> {
  return load(await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8'), { schema }) as Row[]
}

function disabled(row: Row, env: Record<string, string | undefined>): boolean {
  if (typeof row.disabled === 'boolean' || row.disabled === undefined) return row.disabled === true
  return Boolean(new Function('process', `return (${row.disabled.js})`)({ env }))
}

describe('cordis.patch.yml', () => {
  const replaced = ['fs-sandbox', 'subprocess', 'sandbox', 'ptc-runtime']
  const added = ['byclaw-tool-env', 'byclaw-tool-env-fs', 'byclaw-tool-env-subprocess', 'byclaw-tool-env-sandbox', 'byclaw-tool-env-ptc']

  it('changes nothing unless a tool environment backend is selected', async () => {
    const patch = await rows()
    for (const env of [{}, { BYCLAW_DSH_TOOL_ENV: '' }, { BYCLAW_DSH_TOOL_ENV: 'local' }]) {
      for (const row of patch.filter(row => row.id !== undefined)) expect(disabled(row, env), row.id).toBe(false)
      for (const row of patch.flatMap(row => row.insert ?? [])) expect(disabled(row, env), row.id).toBe(true)
    }
  })

  it('swaps the local providers for the SSH providers in split mode', async () => {
    const patch = await rows()
    for (const backend of ['static', 'opensandbox', 'byclaw-be']) {
      const env = { BYCLAW_DSH_TOOL_ENV: backend }
      expect(patch.filter(row => row.id !== undefined && disabled(row, env)).map(row => row.id)).toEqual(replaced)
      expect(patch.flatMap(row => row.insert ?? []).filter(row => !disabled(row, env)).map(row => row.id)).toEqual(added)
    }
  })
})
