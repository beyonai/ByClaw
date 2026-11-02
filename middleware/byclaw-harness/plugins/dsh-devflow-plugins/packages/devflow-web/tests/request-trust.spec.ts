/**
 * The restated browser-trust rule, exercised directly: the route spec proves it
 * is wired in, this proves what it decides. Every arm matters — a fence that is
 * too loose is a confused deputy and one that is too tight is a board that will
 * not load.
 */

import { describe, expect, it } from 'vitest'
import { assertTrustedAuthority, isTrustedRequest } from '../src/request-trust.ts'

/** Decide one request from its headers. */
function trusts(headers: Record<string, string>, trustedHosts: string[] = []): boolean {
  return isTrustedRequest({ headers }, trustedHosts)
}

describe('devflow-web trust fence', () => {
  it('binds every request to a Host this server answers for', () => {
    for (const host of ['127.0.0.1:7777', 'localhost', '[::1]:80', '127.13.0.9']) {
      expect(trusts({ host })).toBe(true)
    }
    // A rebound page carries the attacker's authority; so does a plain miss.
    expect(trusts({ host: 'evil.example' })).toBe(false)
    // No Host at all, and a Host that does not parse, are both refusals.
    expect(trusts({})).toBe(false)
    expect(trusts({ host: 'a b:c' })).toBe(false)
  })

  it('admits configured authorities, exactly or on any port', () => {
    // A port-less entry matches the hostname on any port.
    expect(trusts({ host: 'harness.internal:8080' }, ['harness.internal'])).toBe(true)
    expect(trusts({ host: 'harness.internal' }, ['harness.internal'])).toBe(true)
    // An entry with a port matches that authority alone.
    expect(trusts({ host: '10.0.0.4:7777' }, ['10.0.0.4:7777'])).toBe(true)
    expect(trusts({ host: '10.0.0.4:9999' }, ['10.0.0.4:7777'])).toBe(false)
    // Case and a redundant default port never decide trust.
    expect(trusts({ host: 'HARNESS.internal:80' }, ['harness.internal:80'])).toBe(true)
    // An unparsable entry grants nothing rather than throwing at request time.
    expect(trusts({ host: 'harness.internal' }, ['a b'])).toBe(false)
    expect(trusts({ host: 'other.example' }, ['harness.internal'])).toBe(false)
  })

  it('refuses cross-site fetches and foreign origins', () => {
    expect(trusts({ host: '127.0.0.1:7777', 'sec-fetch-site': 'cross-site' })).toBe(false)
    expect(trusts({ host: '127.0.0.1:7777', 'sec-fetch-site': 'same-origin' })).toBe(true)
    expect(trusts({ host: '127.0.0.1:7777', origin: 'http://127.0.0.1:7777' })).toBe(true)
    expect(trusts({ host: '127.0.0.1:7777', origin: 'http://evil.example' })).toBe(false)
    // The opaque origin of a sandboxed iframe or a file: page is refused.
    expect(trusts({ host: '127.0.0.1:7777', origin: 'null' })).toBe(false)
  })

  it('refuses a trustedHosts entry that is not a canonical bare authority', () => {
    for (const entry of ['harness.internal', 'harness.internal:8080', '10.0.0.4', '[::1]:80']) {
      expect(() => { assertTrustedAuthority(entry) }).not.toThrow()
    }
    for (const entry of [
      'http://harness.internal', // a scheme is not an authority
      'harness.internal/board', // a path would be silently dropped
      'user@harness.internal', // the embedded hostname would be the one authorized
      'harness.internal:', // a dangling colon would widen the grant to every port
      'harness.internal:08080', // a zero-padded port likewise
      ' harness.internal', // whitespace would be trimmed away
      '0x7f.0.0.1', // a non-canonical host spelling
      '::1', // an unbracketed IPv6 literal
    ]) {
      expect(() => { assertTrustedAuthority(entry) }).toThrow(/not a bare host/)
    }
  })
})
