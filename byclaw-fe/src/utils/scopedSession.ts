import type { ISession } from '@/typescript/session';

export const getExternalSessionExt = (session: ISession | undefined, code: string): string | undefined =>
  session?.sessionExts?.find((item) => item.extParamCode === code)?.extParamValue;

export const isExternalChildSession = (session: ISession | undefined): boolean =>
  Boolean(session?.parentSessionId && getExternalSessionExt(session, 'external_session_id'));

export const isExternalChildExtParams = (extParams: unknown): boolean =>
  Boolean(extParams && typeof extParams === 'object' && (extParams as Record<string, unknown>).external_session_id);

export const isScopedChildProjection = (projection: unknown): boolean => {
  if (!projection || typeof projection !== 'object') return false;
  const rawMetadata = (projection as Record<string, unknown>).metadata;
  try {
    const metadata =
      typeof rawMetadata === 'string' ? JSON.parse(rawMetadata || '{}') : (rawMetadata as Record<string, unknown>);
    return metadata?.session_scope === 'child' && Boolean(metadata?.external_session_id);
  } catch (error) {
    return false;
  }
};

export type ScopedChildRunState = {
  childRunId?: string;
  childTurn?: number;
  lastStreamId?: string;
  running: boolean;
};

export const compareScopedStreamId = (left: string, right: string): number => {
  const leftParts = left.split('-').map((item) => Number(item));
  const rightParts = right.split('-').map((item) => Number(item));
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = Number.isFinite(leftParts[index]) ? leftParts[index] : 0;
    const rightValue = Number.isFinite(rightParts[index]) ? rightParts[index] : 0;
    if (leftValue > rightValue) return 1;
    if (leftValue < rightValue) return -1;
  }
  return 0;
};

const parseProjectionMetadata = (projection: Record<string, any>): Record<string, any> => {
  try {
    return typeof projection.metadata === 'string'
      ? JSON.parse(projection.metadata || '{}')
      : projection.metadata || {};
  } catch {
    return {};
  }
};

export const getScopedChildRunState = (
  projection: Record<string, any>,
  envelopeStreamId?: string
): ScopedChildRunState => {
  const metadata = parseProjectionMetadata(projection);
  const childTurnValue = projection.childTurn ?? metadata.child_turn;
  const childTurn = Number(childTurnValue);
  const status = `${metadata.session_status || ''}`.toLowerCase();
  const terminalStatus = ['completed', 'failed', 'cancelled', 'canceled', 'idle'].includes(status);
  return {
    childRunId: `${projection.childRunId || metadata.child_run_id || ''}` || undefined,
    childTurn: Number.isFinite(childTurn) ? childTurn : undefined,
    lastStreamId: `${projection.snapshotStreamId || projection.streamId || envelopeStreamId || ''}` || undefined,
    running: projection.running !== false && `${projection.msgStatus}` !== '0' && !terminalStatus,
  };
};

export const shouldApplyScopedChildRun = (
  current: ScopedChildRunState | undefined,
  incoming: ScopedChildRunState
): boolean => {
  if (!current) return true;

  const currentVersioned = Boolean(current.childRunId && current.childTurn !== undefined);
  const incomingVersioned = Boolean(incoming.childRunId && incoming.childTurn !== undefined);
  if (currentVersioned && !incomingVersioned) return false;
  if (currentVersioned && incomingVersioned) {
    if (incoming.childTurn! > current.childTurn!) return true;
    if (incoming.childTurn! < current.childTurn!) return false;
    if (incoming.childRunId !== current.childRunId) return false;
  } else if (current.childRunId && incoming.childRunId && current.childRunId !== incoming.childRunId) {
    return false;
  }

  if (current.lastStreamId && incoming.lastStreamId) {
    return compareScopedStreamId(incoming.lastStreamId, current.lastStreamId) > 0;
  }
  return true;
};

/**
 * Check whether a scoped child projection is newer without advancing its watermark.
 * The caller commits only after the projection was rendered successfully.
 */
export const isScopedStreamNewer = (
  watermarks: Map<string, string>,
  sessionId: string | undefined,
  streamId: string | undefined
): boolean => {
  if (!sessionId || !streamId) return true;
  const previous = watermarks.get(sessionId);
  return !previous || compareScopedStreamId(streamId, previous) > 0;
};

export const commitScopedStream = (
  watermarks: Map<string, string>,
  sessionId: string | undefined,
  streamId: string | undefined
): void => {
  if (sessionId && streamId) watermarks.set(sessionId, streamId);
};
