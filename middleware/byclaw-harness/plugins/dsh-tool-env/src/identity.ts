/**
 * SSH identity for one A↔B pair, kept in A's private DSH home.
 *
 * A owns both key pairs: the client key it logs in with and the host key B
 * serves. B receives them through its create request, so A can pin B's host key
 * without trusting first contact, and a recreated B keeps the same identity.
 */
import { execFile } from 'node:child_process'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ToolEnvEndpoint } from './backend.ts'

const run = promisify(execFile)

/** Material B needs to accept exactly this A. */
export interface ToolEnvKeys {
  /** OpenSSH public key line authorized for the tool user. */
  authorizedKey: string
  /** OpenSSH private host key B serves. */
  hostPrivateKey: string
}

/** Key files plus the OpenSSH alias that SshConnection dials. */
export class ToolEnvIdentity {
  readonly alias: string
  private readonly clientKey: string
  private readonly hostKey: string
  private readonly knownHosts: string
  private readonly clientConfig: string

  constructor(private readonly directory: string, alias = 'byclaw-tool-env', private readonly user = 'byclaw') {
    this.alias = alias
    this.clientKey = join(directory, 'client_ed25519')
    this.hostKey = join(directory, 'host_ed25519')
    this.knownHosts = join(directory, 'known_hosts')
    this.clientConfig = join(directory, 'ssh_config')
  }

  /** Create missing key pairs and return what B must be started with. */
  async keys(): Promise<ToolEnvKeys> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    await chmod(this.directory, 0o700)
    for (const path of [this.clientKey, this.hostKey]) await ensureKey(path)
    const hostPublic = (await readFile(`${this.hostKey}.pub`, 'utf8')).trim().split(/\s+/).slice(0, 2).join(' ')
    await writeAtomic(this.knownHosts, `${this.alias} ${hostPublic}\n`, 0o600)
    return {
      authorizedKey: (await readFile(`${this.clientKey}.pub`, 'utf8')).trim(),
      hostPrivateKey: await readFile(this.hostKey, 'utf8'),
    }
  }

  /**
   * Point the alias at the current endpoint. SshConnection invokes plain `ssh <alias>`,
   * so the alias lives in the user's OpenSSH configuration through one Include line.
   */
  async writeClientConfig(endpoint: ToolEnvEndpoint): Promise<void> {
    await this.keys()
    await writeAtomic(this.clientConfig, [
      `Host ${this.alias}`,
      `  HostName ${endpoint.hostName}`,
      `  Port ${String(endpoint.port)}`,
      `  User ${this.user}`,
      `  IdentityFile ${this.clientKey}`,
      '  IdentitiesOnly yes',
      `  UserKnownHostsFile ${this.knownHosts}`,
      `  HostKeyAlias ${this.alias}`,
      '  StrictHostKeyChecking yes',
      '  BatchMode yes',
      '  ConnectTimeout 10',
      '',
    ].join('\n'), 0o600)
    await includeInUserConfig(this.clientConfig)
  }
}

async function ensureKey(path: string): Promise<void> {
  try { await readFile(path); await readFile(`${path}.pub`); return } catch { /* create below */ }
  const staging = `${path}.new-${randomUUID()}`
  await run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'byclaw-tool-env', '-f', staging])
  await rename(`${staging}.pub`, `${path}.pub`)
  await rename(staging, path)
}

// Several user contexts in one process share ~/.ssh/config; serialize its edits.
let userConfigEdits: Promise<unknown> = Promise.resolve()

function includeInUserConfig(file: string): Promise<void> {
  const edit = userConfigEdits.catch(() => {}).then(() => addInclude(file))
  userConfigEdits = edit
  return edit
}

async function addInclude(file: string): Promise<void> {
  // OpenSSH reads the passwd entry's home, not $HOME.
  const directory = join(userInfo().homedir, '.ssh')
  const config = join(directory, 'config')
  const line = `Include ${file}`
  await mkdir(directory, { recursive: true, mode: 0o700 })
  let existing = ''
  try { existing = await readFile(config, 'utf8') } catch { /* first use */ }
  if (existing.split('\n').some(entry => entry.trim() === line)) return
  // Include must precede every Host block to apply unconditionally.
  await writeAtomic(config, `${line}\n${existing}`, 0o600)
}

async function writeAtomic(path: string, content: string, mode: number): Promise<void> {
  const staging = `${path}.tmp-${randomUUID()}`
  await writeFile(staging, content, { mode })
  await rename(staging, path)
}
