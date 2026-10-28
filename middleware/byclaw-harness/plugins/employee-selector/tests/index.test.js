import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dump } from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { employeeComposition } from '../src/index.js'

const standardRows = [
  { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: 'p' } },
  { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' },
]

function presets() {
  return {
    readDocument: async id => {
      assert.equal(id, 'standard')
      return { agentPreset: 'standard', content: dump(standardRows, { schema: entryListSchema }) }
    },
  }
}

test('reads the standard capability snapshot without its persona or employee identity', async () => {
  const rows = await employeeComposition(presets())
  assert.deepEqual(rows, [standardRows[1]])
})
