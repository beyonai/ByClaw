/** Runtime artifact identity bound to the public client-module graph and its exact served response. */
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { ClientModuleRegistry } from '@deepseek-ai/dsh-client-modules'
import type { BuildClient, BuildInfo } from './types.ts'
const digest = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')
const SOURCE_MAP_TRAILER = /(?:\r?\n)?\/\/# sourceMappingURL=[^\r\n]*(?:\r?\n)?$/
const SOURCE_URL_TRAILER = /(?:\r?\n)?\/\/# sourceURL=([^\r\n]+)(?:\r?\n)?$/
function newline(value: string): string { return value.endsWith('\n') ? value : value + '\n' }
/** Deployment receipts bind raw local files; request paths are resolved only from the live advertised graph. */
export function artifactIdentity(serverArtifact: string, client: Pick<BuildClient, 'artifact'>): {
  buildId: string
  serverSha256: string
  clientSha256: string
} {
  const serverSha256 = digest(readFileSync(serverArtifact))
  const clientSha256 = digest(readFileSync(client.artifact))
  return { serverSha256, clientSha256, buildId: digest(JSON.stringify({ serverSha256, clientSha256 })) }
}
/** Fail closed after local replacements or when the public registry does not serve this exact client source. */
export function createBuildInfo(
  client?: BuildClient, moduleUrl: string = import.meta.url,
  registry?: () => Pick<ClientModuleRegistry, 'graph' | 'clientPath' | 'fetchBundle'> | undefined,
): () => Promise<BuildInfo> {
  const unavailable: BuildInfo = { schemaVersion: 1, available: false }
  if (!client || !moduleUrl.endsWith('.js')) return () => Promise.resolve(unavailable)
  let initial: ReturnType<typeof artifactIdentity>
  const server = fileURLToPath(new URL('./index.js', moduleUrl))
  try { initial = artifactIdentity(server, client) } catch { return () => Promise.resolve(unavailable) }
  const instanceId = randomUUID()
  return async () => {
    try {
      if (artifactIdentity(server, client).buildId !== initial.buildId) return unavailable
      const modules = registry?.()
      const entry = modules?.graph().entries.find(entry => entry.id === client.entry)
      const actualPath = modules?.clientPath(client.entry)
      if (!modules || !entry || !actualPath || realpathSync(actualPath) !== realpathSync(client.artifact)) return unavailable
      const url = new URL(entry.url, 'http://build.invalid')
      if (url.origin !== 'http://build.invalid' || url.pathname !== '/plugins/' || url.hash) return unavailable
      const response = modules.fetchBundle(new Request(url))
      if (!response.ok) return unavailable
      const bytes = Buffer.from(await response.arrayBuffer())
      // Published rc.2 single-entry combos strip final debug trailers, add a newline + semicolon,
      // then append a revisioned source-map trailer. Match that transform exactly, not arbitrary JS rewrites.
      const local = newline(readFileSync(client.artifact, 'utf8').replace(SOURCE_URL_TRAILER, '').replace(SOURCE_MAP_TRAILER, ''))
      const served = newline(bytes.toString('utf8').replace(SOURCE_MAP_TRAILER, ''))
      if (served !== local + ';\n' || artifactIdentity(server, client).buildId !== initial.buildId) return unavailable
      return { schemaVersion: 1, available: true, buildId: initial.buildId, instanceId,
        serverSha256: initial.serverSha256, client: { path: url.pathname + url.search, sha256: digest(bytes) } }
    } catch { return unavailable }
  }
}
