import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { load, Type, DEFAULT_SCHEMA } from 'js-yaml'

const js = new Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: (source: string) => ({ js: source }) })
interface Row { id?: string; name?: string; disabled?: boolean; insert?: Array<{ id: string; name: string; config: Record<string, { js: string }> }> }

it('replaces the eager recorder and independently defaults both env flags to off', async () => {
  const rows = load(await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8'), { schema: DEFAULT_SCHEMA.extend([js]) }) as Row[]
  expect(rows.find(row => row.id === 'workspace-changes')?.disabled).toBe(true)
  const adapter = rows.flatMap(row => row.insert ?? []).find(row => row.id === 'byclaw-workspace')!
  expect(adapter.name).toBe('@byclaw/dsh-workspace')
  for (const changes of [undefined, '', '0', 'false', '1']) {
    for (const git of [undefined, '', '0', 'false', '1']) {
      const process = { env: { BYCLAW_DSH_WORKSPACE_CHANGES_ENABLED: changes, BYCLAW_DSH_WORKSPACE_GIT_ENABLED: git } }
      const evaluate = (key: string) => new Function('process', `return (${adapter.config[key]!.js})`)(process)
      expect(evaluate('changesEnabled')).toBe(changes === '1')
      expect(evaluate('gitEnabled')).toBe(git === '1')
    }
  }
})
