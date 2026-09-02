import type { SandboxInfo } from '@/service/sandbox';

export type SandboxAggregateStatus = 'running' | 'transitioning' | 'stopped';
export type WorkerLivenessStatus = 'online' | 'offline' | 'unknown';

export const getSandboxItemStatus = (sandbox: SandboxInfo): SandboxAggregateStatus => {
  if (['STARTING', 'RELEASING'].includes(sandbox.status || '')) return 'transitioning';
  if (sandbox.status === 'RUNNING') return 'running';
  return 'stopped';
};

export const getWorkerLivenessStatus = (sandbox: SandboxInfo): WorkerLivenessStatus => {
  if (sandbox.workerOnline === true) return 'online';
  if (sandbox.workerOnline === false) return 'offline';
  return 'unknown';
};

export const calculateSandboxStatus = (sandboxes: SandboxInfo[]): SandboxAggregateStatus => {
  const statuses = (sandboxes || []).map(getSandboxItemStatus);
  if (statuses.includes('transitioning')) return 'transitioning';
  if (statuses.includes('running')) return 'running';
  return 'stopped';
};

export const summarizeSandboxes = (sandboxes: SandboxInfo[]) => {
  const summary = { running: 0, transitioning: 0, stopped: 0, total: 0 };
  (sandboxes || []).forEach((sandbox) => {
    summary[getSandboxItemStatus(sandbox)] += 1;
    summary.total += 1;
  });
  return summary;
};
