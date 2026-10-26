/**
 * What keeps an idle-looking tool environment (B) alive besides its own
 * requests and streams:
 *
 * - DSH's own facts on A: an Agent in a turn, or a background job, is work in
 *   progress even while nothing crosses the connection (the model is thinking).
 * - Processes left on B that no stream watches (`cmd &`, `nohup`, setsid):
 *   only B knows about them, so they are asked for over the connection's own
 *   OpenSSH alias before a release.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** The subset of DSH's `agents` service this reads. */
export interface AgentsView {
  list(): ReadonlyArray<{ id: string; status: string }>
}

/** The subset of DSH's `jobs` service this reads; `list(owner)` scopes to one Agent's jobs. */
export interface JobsView {
  list(owner?: string): ReadonlyArray<{ id: string; status: string }>
}

/**
 * Whether DSH itself has work in progress: an Agent whose status is `running`
 * (a turn is on, whether it is computing or blocked on the user), or a job that
 * is running or stopping. Jobs are listed without an owner and per Agent, as
 * `list()` alone returns only unowned jobs.
 */
export function isDshBusy(agents: AgentsView | undefined, jobs: JobsView | undefined): boolean {
  const live = agents?.list() ?? []
  if (live.some(agent => agent.status === 'running')) return true
  if (jobs === undefined) return false
  for (const view of [jobs.list(), ...live.map(agent => jobs.list(agent.id))]) {
    if (view.some(job => job.status === 'running' || job.status === 'stopping')) return true
  }
  return false
}

/** Marker in the probe command, so the probe does not count itself. */
const PROBE_MARKER = 'BYCLAW_TOOL_ENV_PROBE'

/** `ps` columns of the probe: pid, command name, full arguments; the tool user's processes only. */
export const PROBE_SCRIPT = `ps -u "$(id -un)" -o pid=,comm=,args= 2>/dev/null; : ${PROBE_MARKER}`

/** One process on B that nothing on A is attached to. */
export interface ResidualProcess { pid: number; comm: string; args: string }

/**
 * Processes of the tool user on B that are not part of serving A: the sshd
 * session processes, the DSH helper and PTC bootstrap A launched over SSH, the
 * probe's own shell and `ps`. What remains was started by the user's commands
 * and detached from any stream.
 */
export function residualProcesses(psOutput: string): ResidualProcess[] {
  const residual: ResidualProcess[] = []
  for (const raw of psOutput.split('\n')) {
    const line = raw.trim()
    const match = /^(\d+)\s+(\S+)\s*(.*)$/u.exec(line)
    if (match === null) continue
    const pid = Number(match[1]); const comm = match[2] ?? ''; const args = match[3] ?? ''
    if (comm === 'sshd' || comm.startsWith('sshd')) continue
    if (comm === 'ps') continue
    if (args.includes(PROBE_MARKER)) continue
    if (/dsh-ssh[\\/]|dsh-ptc-runtime|\/process\.js(\s|$)/u.test(args)) continue
    residual.push({ pid, comm, args })
  }
  return residual
}

/**
 * Ask B over the connection's OpenSSH alias (the same `ssh <alias>` the inner
 * connection uses) which residual processes it runs. A B that cannot be reached
 * has nothing to keep alive: errors and timeouts count as none.
 */
export async function probeResidualProcesses(alias: string, timeoutMs = 20_000): Promise<ResidualProcess[]> {
  try {
    const { stdout } = await run('ssh', ['-o', 'BatchMode=yes', alias, 'sh', '-c', `'${PROBE_SCRIPT}'`], { timeout: timeoutMs, maxBuffer: 1024 * 1024 })
    return residualProcesses(stdout)
  } catch {
    return []
  }
}

/** Short description for a log line. */
export function describeResidual(processes: readonly ResidualProcess[], limit = 3): string {
  return processes.slice(0, limit).map(process => `${process.comm}[${String(process.pid)}]`).join(', ') + (processes.length > limit ? ', …' : '')
}
