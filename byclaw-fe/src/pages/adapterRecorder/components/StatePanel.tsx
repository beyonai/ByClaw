// 会话状态 —— 细 chip 带(state / sessionId / 目标 URL)。极简,只留对当前步骤有用的信息。
import { isFailed } from '../constants/recorder';
import type { SessionState } from '../types/recorder';

interface Props {
  state: SessionState;
  stateVersion: number;
  sessionId?: string;
  targetUrl?: string;
}

export default function StatePanel({ state, sessionId, targetUrl }: Props) {
  const failed = isFailed(state);
  return (
    <div className="wb-statebar" aria-label="会话状态">
      <span className={`wb-chip wb-chip--state${failed ? ' wb-chip--err' : ''}`}>
        <span className="wb-chip__dot" aria-hidden />
        <span className="wb-chip__v">{state}</span>
      </span>
      <span className="wb-chip">
        <span className="wb-chip__k">session</span>
        <span className={`wb-chip__v${sessionId ? '' : ' wb-chip__v--muted'}`}>{sessionId ?? '—'}</span>
      </span>
      {targetUrl && (
        <span className="wb-chip" title={targetUrl}>
          <span className="wb-chip__k">url</span>
          <span className="wb-chip__v">{targetUrl}</span>
        </span>
      )}
    </div>
  );
}
