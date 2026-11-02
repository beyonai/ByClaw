/** Context-owned lease gate: stopping admission never cancels active commands. */
export interface ManagedAdmissionLease { allowed(): boolean }
export class ManagedAdmission {
  activeRequests = 0
  private stopped = false
  private readonly lease: ManagedAdmissionLease
  private readonly stop: () => void
  constructor(lease: ManagedAdmissionLease, stop: () => void) { this.lease = lease; this.stop = stop }
  check(): boolean {
    if (!this.lease.allowed() && !this.stopped) { this.stopped = true; this.stop() }
    return !this.stopped
  }
  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.check()) throw new Error('Managed context lease expired; new execution refused')
    this.activeRequests++
    try { return await operation() } finally { this.activeRequests-- }
  }
}
