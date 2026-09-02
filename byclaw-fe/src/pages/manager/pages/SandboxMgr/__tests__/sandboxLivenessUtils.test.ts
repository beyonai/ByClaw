import { formatWorkerLeaseTtl, getSandboxLifecycleStatus, getWorkerLivenessStatus } from '../sandboxLivenessUtils';

describe('sandbox liveness utilities', () => {
  it('does not infer worker online state from the sandbox lifecycle', () => {
    const record = { status: 'RUNNING', workerOnline: false };

    expect(getSandboxLifecycleStatus(record)).toBe('RUNNING');
    expect(getWorkerLivenessStatus(record)).toBe('offline');
  });

  it('reports an unknown worker state when the registry did not provide one', () => {
    expect(getWorkerLivenessStatus({ status: 'RUNNING' })).toBe('unknown');
  });

  it('formats the remaining worker lease separately from remote sandbox expiry', () => {
    expect(formatWorkerLeaseTtl(42)).toBe('42s');
    expect(formatWorkerLeaseTtl(0)).toBe('0s');
    expect(formatWorkerLeaseTtl(undefined)).toBe('-');
  });
});
