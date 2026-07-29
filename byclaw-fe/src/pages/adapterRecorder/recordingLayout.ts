import type { SessionState } from './types/recorder';

export function isActiveRecordingLayout(state: SessionState, recording?: 'A' | 'B' | null): boolean {
  return state === 'page_ready' && Boolean(recording);
}
