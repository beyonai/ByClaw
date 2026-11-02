import assert from 'node:assert/strict'
import { installDefaultWebSearchPolicy } from '../src/default-web-search-policy.ts'

let guard
let disposed = false
const dispose = installDefaultWebSearchPolicy({
  guard(candidate) {
    guard = candidate
    return () => { disposed = true }
  },
})

assert.equal(typeof guard, 'function', 'policy must register a monotonic tool guard')
assert.match(guard({ name: 'web_search' }), /deepseek-web-search/u)
assert.equal(guard({ name: 'web_fetch' }), undefined, 'web_fetch is not the default search bypass')
assert.equal(guard({ name: 'skill' }), undefined, 'the managed Skill must remain usable')
dispose()
assert.equal(disposed, true, 'policy must expose the registry disposer')

console.log('default-web-search-policy-verify ok')
