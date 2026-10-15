/**
 * Additional deployment authority restriction for Devflow routes.
 * The public Connection.requestRejection method separately enforces the host
 * policy and signed browser cookie; passing this local fence never authorizes
 * a request by itself.
 *
 * Two confused-deputy paths are closed. DNS rebinding: a browser fills `Host`
 * from the name it believes it is talking to, so a rebound page carries the
 * attacker's authority even though the socket lands here — `Host` is the one
 * header rebinding cannot forge, and it binds every request, marked or not.
 * Cross-site requests: a browser labels the initiator relationship on every
 * fetch, and attaches an `Origin` that must be this authority.
 *
 * Network reachability and authentication stay out of scope: what the server
 * binds to is webserver config, and this is not an auth layer.
 */

import type { IncomingHttpHeaders } from 'node:http'

/** The request facts the fence reads. */
export interface TrustedRequest {
  headers: IncomingHttpHeaders
}

/*
 * jscpd:ignore-start — the loopback classification is deliberately identical to
 * the harness's; diverging from it here would be the defect.
 */
/** Whether a normalized URL hostname names the local loopback authority. */
function isLoopback(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}
/* jscpd:ignore-end */

/** Normalized URL of a bare authority, or undefined when it does not parse. */
function parseAuthority(authority: string): URL | undefined {
  try {
    // http: is a WHATWG "special scheme": parsing yields a non-empty hostname or throws.
    return new URL(`http://${authority}`)
  } catch {
    return undefined
  }
}

/**
 * Canonical form of a parsed authority: `hostname` when no port was written,
 * else `hostname:port`. The port is judged from parses under both special
 * schemes, whose default ports differ, so an explicit `:80` still counts as
 * written — never from the raw string, where WHATWG trimming would misread
 * shapes like `host:port ` as port-less.
 */
function canonical(entry: string, entryUrl: URL): string {
  // An authority that parsed under http cannot fail under https.
  const port = entryUrl.port !== '' ? entryUrl.port : new URL(`https://${entry}`).port
  return port === '' ? entryUrl.hostname : `${entryUrl.hostname}:${port}`
}

/**
 * Assert one configured `trustedHosts` entry is a bare authority in canonical
 * form, so a typo fails the load instead of silently broadening or voiding the
 * grant: URL parts beyond the authority (a path, or a `user@host` whose
 * embedded hostname would be the one authorized), a dangling colon or
 * zero-padded port (which would widen an exact-port grant to every port), and
 * non-canonical host spellings all refuse.
 * @param entry - the configured value, verbatim.
 * @throws {Error} when the entry is not a canonical bare `host` or `host:port`.
 */
export function assertTrustedAuthority(entry: string): void {
  const entryUrl = parseAuthority(entry)
  if (entryUrl !== undefined && canonical(entry, entryUrl) === entry.toLowerCase()) return
  throw new Error(`devflow-web: trustedHosts entry ${JSON.stringify(entry)} is not a bare host[:port] authority`)
}

/**
 * Decide whether one request may reach the read face.
 * @param request - the incoming request's headers.
 * @param trustedHosts - non-loopback authorities this deployment serves: an exact `host:port`, or a port-less `host` matching any port.
 * @returns true when the Host is ours and any attached browser markers are same-origin.
 */
export function isTrustedRequest(request: TrustedRequest, trustedHosts: readonly string[]): boolean {
  const host = request.headers.host
  if (host === undefined) return false
  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) return false
  if (!isLoopback(hostUrl.hostname) && !trustedHosts.some((entry) => {
    const entryUrl = parseAuthority(entry)
    if (entryUrl === undefined) return false
    // A port-less entry matches the hostname on any port (the shape a deployment
    // derives for IP-literal LAN serving, where the port may be OS-assigned).
    return canonical(entry, entryUrl) === entryUrl.hostname
      ? entryUrl.hostname === hostUrl.hostname
      : entryUrl.host === hostUrl.host
  })) return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  // Absent Origin is fine — the Host fence already bound the request. The
  // literal "null" (sandboxed iframes, file: pages) is opaque, and refused.
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}
