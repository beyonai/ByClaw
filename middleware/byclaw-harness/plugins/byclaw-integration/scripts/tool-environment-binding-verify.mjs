/** Tool-environment binding verification: declaration, inference from Skills, binding, snapshot parsing. */

import assert from 'node:assert/strict'
import { bindTemplateEnvironment, inferToolEnvironment, requiredBins } from '../src/tool-environment-binding.ts'
import { parseByClawDigitalEmployee } from '../src/resources.ts'

const media = `---
name: podcast-video
description: makes videos
metadata:
  openclaw:
    requires:
      bins: [ffmpeg, node]
---
# body`

const plain = `---
name: tech-article
description: writes
metadata:
  openclaw:
    requires:
      bins: [node]
---`

// requiredBins reads metadata.openclaw.requires.bins from the frontmatter and nothing else.
assert.deepEqual(requiredBins(media), ['ffmpeg', 'node'])
assert.deepEqual(requiredBins(plain), ['node'])
assert.deepEqual(requiredBins('# no frontmatter'), [])
assert.deepEqual(requiredBins('---\nname: x\n---\n'), [])
assert.deepEqual(requiredBins('---\n: bad: [yaml\n---\n'), [])

// inferToolEnvironment prefers the declaration, then the Skills, then nothing.
const files = { '/skills/video/SKILL.md': media, '/skills/article/SKILL.md': plain }
const read = (path) => { const text = files[path]; if (text === undefined) throw new Error('ENOENT'); return text }
assert.equal(inferToolEnvironment({ toolEnvironment: 'gpu', skills: [{ code: 'video', path: '/skills/video' }] }, undefined, read), 'gpu')
assert.equal(inferToolEnvironment({ skills: [{ code: 'article', path: '/skills/article' }, { code: 'video', path: '/skills/video' }] }, undefined, read), 'media')
assert.equal(inferToolEnvironment({ skills: [{ code: 'article', path: '/skills/article' }] }, undefined, read), undefined)
assert.equal(inferToolEnvironment({ toolEnvironment: '  ', skills: [{ code: 'missing', path: '/skills/missing' }] }, undefined, read), undefined)
assert.equal(inferToolEnvironment({ skills: [{ code: 'video', path: '/skills/video' }] }, [{ environment: 'av', bins: ['FFMPEG'] }], read), 'av')

// bindTemplateEnvironment binds declared environments, falls back to the default for unknown ones,
// and does nothing without a pool or without a wish.
const log = { infos: [], warns: [], info(message) { this.infos.push(message) }, warn(message) { this.warns.push(message) } }
const bound = []
const binder = {
  defaultName: 'default',
  has: name => name === 'media',
  bind: (id, name) => { bound.push([id, name]); return () => { bound.pop() } },
}
bindTemplateEnvironment(binder, 'a1', { id: 't1', toolEnvironment: 'media', skills: [] }, log)
assert.deepEqual(bound, [['a1', 'media']])
bindTemplateEnvironment(binder, 'a2', { id: 't2', toolEnvironment: 'quantum', skills: [] }, log)
assert.deepEqual(bound.at(-1), ['a2', 'default'])
assert.ok(log.warns[0].includes('"quantum"'))
const dispose = bindTemplateEnvironment(binder, 'a3', { id: 't3', skills: [] }, log)
dispose()
assert.equal(bound.length, 2)
assert.equal(typeof bindTemplateEnvironment(undefined, 'a4', { id: 't4', toolEnvironment: 'media', skills: [] }, log), 'function')
assert.equal(bound.length, 2)
assert.ok(log.infos.some(line => line.includes('environment=media')))

// parseByClawDigitalEmployee reads the environment from advancedSettings or a top-level field.
const base = { resourceId: '11', resourceName: 'Video', workerAgentType: 'BYCLAW_EXE' }
assert.equal(parseByClawDigitalEmployee({ ...base, advancedSettings: JSON.stringify({ toolEnvironment: 'media', other: 1 }) }).toolEnvironment, 'media')
assert.equal(parseByClawDigitalEmployee({ ...base, toolEnvironment: 'gpu', advancedSettings: JSON.stringify({ toolEnvironment: 'media' }) }).toolEnvironment, 'gpu')
assert.equal(parseByClawDigitalEmployee(base).toolEnvironment, undefined)

console.log('tool-environment-binding verify: ok')
