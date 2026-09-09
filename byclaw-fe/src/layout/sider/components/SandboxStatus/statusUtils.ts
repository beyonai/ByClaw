import type { ISandboxesInfo } from '@/models/common/useAppStore';

export type SandboxAggregateStatus = 'running' | 'transitioning' | 'stopped';
export type WorkerLivenessStatus = 'online' | 'offline' | 'unknown';

export const getSandboxItemStatus = (sandbox: ISandboxesInfo): SandboxAggregateStatus => {
  if (['STARTING', 'RELEASING'].includes(sandbox.status || '')) return 'transitioning';
  if (sandbox.status === 'RUNNING') return 'running';
  return 'stopped';
};

export const getWorkerLivenessStatus = (sandbox: ISandboxesInfo): WorkerLivenessStatus => {
  if (sandbox.workerOnline === true) return 'online';
  if (sandbox.workerOnline === false) return 'offline';
  return 'unknown';
};

export const calculateSandboxStatus = (sandboxes: ISandboxesInfo[]): SandboxAggregateStatus => {
  const statuses = (sandboxes || []).map(getSandboxItemStatus);
  if (statuses.includes('transitioning')) return 'transitioning';
  if (statuses.includes('running')) return 'running';
  return 'stopped';
};

export const summarizeSandboxes = (sandboxes: ISandboxesInfo[]) => {
  const summary = { running: 0, transitioning: 0, stopped: 0, total: 0 };
  (sandboxes || []).forEach((sandbox) => {
    summary[getSandboxItemStatus(sandbox)] += 1;
    summary.total += 1;
  });
  return summary;
};
