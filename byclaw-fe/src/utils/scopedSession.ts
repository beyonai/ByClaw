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

const compareStreamId = (left: string, right: string): number => {
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
  return !previous || compareStreamId(streamId, previous) > 0;
};

export const commitScopedStream = (
  watermarks: Map<string, string>,
  sessionId: string | undefined,
  streamId: string | undefined
): void => {
  if (sessionId && streamId) watermarks.set(sessionId, streamId);
};
