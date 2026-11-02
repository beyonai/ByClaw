import { POST } from '@/service/common/request';

export interface RecoveryQueue {
  stream: string;
  group: string;
  kind: 'COMMAND' | 'WAKEUP' | 'DELIVERY' | 'DEADLETTER';
  pending: number;
  waiting?: number | null;
}

export interface RecoveryMessage {
  id: string;
  kind: RecoveryQueue['kind'];
  state: string;
  userCode?: string;
  userName?: string;
  resourceId?: string;
  resourceName?: string;
  sessionId?: string;
  commandId?: string;
  targetAgentType?: string;
  consumer?: string;
  workerOnline: boolean;
  consumerOnline: boolean;
  executionStatus?: string;
  deliveries: number;
  idleMs?: number;
  queuedAt: number;
  lastDeliveredAt?: number;
  stoppedAt?: number;
  content?: string;
  error?: string;
  payloadMissing: boolean;
  canWake: boolean;
  canDismiss: boolean;
  canConfirmWake: boolean;
  actionHint: string;
  sandboxId?: string;
  sandboxStatus?: string;
  lastOperation?: Record<string, string>;
}

export type RecoveryAction = 'WAKE' | 'DISMISS' | 'CONFIRM_WAKE';

export const listRecoveryQueues = (cursor = '0'): Promise<{ items: RecoveryQueue[]; nextCursor: string }> =>
  POST('/byaiService/sandbox/recovery/queues', { cursor });

export const listRecoveryMessages = (
  queue: RecoveryQueue,
  state: string,
  cursor?: string
): Promise<{ items: RecoveryMessage[]; nextCursor?: string }> =>
  POST('/byaiService/sandbox/recovery/messages', { stream: queue.stream, group: queue.group, state, cursor });

export const actOnRecoveryMessage = (
  queue: RecoveryQueue,
  id: string,
  action: RecoveryAction,
  reason: string
): Promise<{ message: string }> =>
  POST(
    '/byaiService/sandbox/recovery/action',
    { stream: queue.stream, group: queue.group, id, action, reason },
    { timeout: 180000 }
  );

export const listRecoveryHistory = (): Promise<Record<string, string>[]> =>
  POST('/byaiService/sandbox/recovery/history', {});
