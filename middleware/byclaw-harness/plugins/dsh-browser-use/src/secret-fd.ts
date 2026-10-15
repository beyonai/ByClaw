import { closeSync, readSync } from 'node:fs'

const MAX_SECRET_BYTES = 512

/** Consume a short broker secret from an inherited descriptor and close it immediately. */
export function readBrowserSecretFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  variable = 'BYCLAW_BROWSER_SECRET_FD',
): string {
  const raw = environment[variable]
  delete environment[variable]
  if (!raw || !/^(?:0|[1-9]\d*)$/.test(raw)) {
    throw new Error('browser-broker-secret-unavailable')
  }
  const fd = Number(raw)
  if (!Number.isSafeInteger(fd)) throw new Error('browser-broker-secret-unavailable')

  const bytes = Buffer.allocUnsafe(MAX_SECRET_BYTES + 1)
  let length = 0
  try {
    length = readSync(fd, bytes, 0, bytes.byteLength, null)
  } catch {
    throw new Error('browser-broker-secret-unavailable')
  } finally {
    try { closeSync(fd) } catch {}
  }
  if (length === 0 || length > MAX_SECRET_BYTES) {
    bytes.fill(0)
    throw new Error('browser-broker-secret-unavailable')
  }
  const secret = bytes.subarray(0, length).toString('utf8')
  bytes.fill(0)
  if (!secret || /[\r\n\0]/.test(secret)) throw new Error('browser-broker-secret-unavailable')
  return secret
}
