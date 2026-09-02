export type WorkerLivenessStatus = 'online' | 'offline' | 'unknown';

interface SandboxLivenessRecord {
  status?: string;
  workerOnline?: boolean;
}

export const getSandboxLifecycleStatus = (record: SandboxLivenessRecord) => record.status;

export const getWorkerLivenessStatus = (record: SandboxLivenessRecord): WorkerLivenessStatus => {
  if (record.workerOnline === true) return 'online';
  if (record.workerOnline === false) return 'offline';
  return 'unknown';
};

export const formatWorkerLeaseTtl = (seconds?: number) =>
  typeof seconds === 'number' && Number.isFinite(seconds) ? `${seconds}s` : '-';
