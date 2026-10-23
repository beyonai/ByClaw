import test from 'node:test'
import assert from 'node:assert/strict'
import { persistAssets } from '../src/artifacts.js'

const mp3 = Buffer.from('ID3fixture')

test('persistAssets writes through a supplied io instead of the host filesystem', async () => {
  const calls = []
  const files = new Map()
  const io = {
    realpath: async path => { calls.push(['realpath', path]); return path },
    mkdir: async path => { calls.push(['mkdir', path]) },
    writeExclusive: async (path, bytes) => {
      if (files.has(path)) throw Object.assign(new Error('exists'), { code: 'EEXIST' })
      files.set(path, Buffer.from(bytes))
    },
    remove: async path => { files.delete(path) },
  }
  const [artifact] = await persistAssets('/remote/by/.sessions/s1', 'tts', [{ bytes: mp3, mimeType: 'audio/mpeg' }], io)
  assert.match(artifact.path, /^\/remote\/by\/\.sessions\/s1\/tts\/[0-9a-f-]+\.mp3$/u)
  assert.deepEqual(files.get(artifact.path), mp3)
  assert.deepEqual(calls.slice(0, 2), [['realpath', '/remote/by/.sessions/s1'], ['mkdir', '/remote/by/.sessions/s1/tts']])
})

test('persistAssets io rejects a symlinked artifact directory and cleans partial writes', async () => {
  const symlinked = {
    realpath: async path => path.endsWith('/tts') ? '/elsewhere' : path,
    mkdir: async () => {}, writeExclusive: async () => {}, remove: async () => {},
  }
  await assert.rejects(persistAssets('/r', 'tts', [{ bytes: mp3, mimeType: 'audio/mpeg' }], symlinked), /MEDIA_ARTIFACT_DIRECTORY/)
  const removed = []
  let writes = 0
  const failing = {
    realpath: async path => path, mkdir: async () => {},
    writeExclusive: async () => { if (++writes === 2) throw new Error('disk full') },
    remove: async path => { removed.push(path) },
  }
  await assert.rejects(persistAssets('/r', 'tts', [{ bytes: mp3, mimeType: 'audio/mpeg' }, { bytes: mp3, mimeType: 'audio/mpeg' }], failing), /disk full/)
  assert.equal(removed.length, 1)
})
