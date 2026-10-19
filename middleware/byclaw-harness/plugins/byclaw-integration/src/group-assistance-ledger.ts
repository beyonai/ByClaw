/** Durable request/result correlation for a DIRECT employee that has no TeamTask yet. */
import { assistanceFingerprint, withTeamLock, type GroupTaskBlocker } from '@byclaw/dsh-agent-teams'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface SoloAssistanceRecord {
  id: string; parentId: string; childId: string; taskSessionId: string; coordinatorAgentId: string;
  requestKey: string; inputRevision: string; objective: string; inputs?: string;
  status: 'pending' | 'completed' | 'blocked'; result?: string; blockingReason?: GroupTaskBlocker['reason']
}
interface SoloLedger {
  schemaVersion: 'byclaw.group-assistance-ledger/v1'; requests: SoloAssistanceRecord[];
  waitingUser?: { inputRevision: string; requestId: string; message: string }
}
function ledgerPath(stateRoot: string, parentId: string): string {
  return join(stateRoot, 'assistance', `${createHash('sha256').update(parentId).digest('hex')}.json`)
}
function emptyLedger(): SoloLedger { return { schemaVersion: 'byclaw.group-assistance-ledger/v1', requests: [] } }
function parseLedger(value: string): SoloLedger {
  const ledger = JSON.parse(value) as SoloLedger
  if (ledger.schemaVersion !== 'byclaw.group-assistance-ledger/v1' || !Array.isArray(ledger.requests)) throw new Error('Invalid group assistance ledger')
  return ledger
}
async function readLedger(path: string): Promise<SoloLedger> {
  try { return parseLedger(await readFile(path, 'utf8')) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyLedger()
    throw error
  }
}
async function writeLedger(path: string, ledger: SoloLedger): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(ledger), { mode: 0o600 })
  await rename(temporary, path)
}
export function soloAssistanceForChild(stateRoot: string, parentId: string, childId: string): SoloAssistanceRecord | undefined {
  try { return parseLedger(readFileSync(ledgerPath(stateRoot, parentId), 'utf8')).requests.find(request => request.childId === childId) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
}
export async function requestSoloAssistance(stateRoot: string, input: {
  parentId: string; taskSessionId: string; coordinatorAgentId: string; objective: string; inputs?: string; inputRevision?: string
}): Promise<{ record: SoloAssistanceRecord; reused: boolean }> {
  const path = ledgerPath(stateRoot, input.parentId)
  return withTeamLock(`solo-assistance:${path}`, async () => {
    const ledger = await readLedger(path)
    const inputRevision = input.inputRevision ?? ledger.requests.at(-1)?.inputRevision ?? input.taskSessionId
    const requestKey = assistanceFingerprint(input.taskSessionId, input.parentId, input.parentId, input.objective, inputRevision)
    const sameRevision = ledger.requests.filter(request => request.inputRevision === inputRevision)
    const waiting = ledger.waitingUser?.inputRevision === inputRevision ? ledger.requests.find(request => request.id === ledger.waitingUser!.requestId) : undefined
    if (waiting !== undefined) return { record: { ...waiting, status: 'blocked', blockingReason: 'no_progress', result: ledger.waitingUser!.message }, reused: true }
    const existing = sameRevision.find(request => request.requestKey === requestKey)
      ?? sameRevision.find(request => request.status === 'blocked' || request.status === 'pending')
      ?? ledger.requests.find(request => request.status === 'pending')
    if (existing !== undefined) return { record: existing, reused: true }
    const record: SoloAssistanceRecord = { ...input, inputRevision, id: randomUUID(), childId: randomUUID(), requestKey, status: 'pending' }
    ledger.requests.push(record)
    delete ledger.waitingUser
    await writeLedger(path, ledger)
    return { record, reused: false }
  })
}
export async function resolveSoloAssistance(stateRoot: string, parentId: string, childId: string,
  result: string, status: 'completed' | 'blocked', blockingReason?: GroupTaskBlocker['reason']): Promise<SoloAssistanceRecord> {
  if (!result.trim()) throw new Error('Assistance requires an actual result or precise missing-input description')
  if (status === 'blocked' && blockingReason === undefined) throw new Error('Blocked assistance requires blocking_reason')
  const path = ledgerPath(stateRoot, parentId)
  return withTeamLock(`solo-assistance:${path}`, async () => {
    const ledger = await readLedger(path)
    const record = ledger.requests.find(request => request.childId === childId)
    if (record === undefined) throw new Error('This assistant child does not own a linked assistance request')
    if (record.status !== 'pending') {
      if (record.status !== status || record.result !== result || record.blockingReason !== blockingReason) throw new Error('Assistance result was already delivered and cannot be replaced')
      return record
    }
    record.status = status; record.result = result
    if (blockingReason !== undefined) record.blockingReason = blockingReason
    await writeLedger(path, ledger)
    return record
  })
}
