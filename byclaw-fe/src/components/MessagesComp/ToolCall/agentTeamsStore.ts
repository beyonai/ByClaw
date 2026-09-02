import { useSyncExternalStore } from 'react';

import type { AgentTeamsSnapshot } from './AgentTeamsActivity';
import { getScopedChildRunState, shouldApplyScopedChildRun } from '@/utils/scopedSession';

const snapshots = new Map<string, AgentTeamsSnapshot>();
const listeners = new Map<string, Set<() => void>>();

const capturedTime = (snapshot: AgentTeamsSnapshot) => {
  const value = Date.parse(snapshot.capturedAt || '');
  return Number.isFinite(value) ? value : 0;
};

export const getAgentTeamsSnapshot = (rootSessionId: string) => snapshots.get(`${rootSessionId}`);

export const publishAgentTeamsSnapshot = (rootSessionId: string, snapshot: AgentTeamsSnapshot) => {
  const key = `${rootSessionId}`;
  if (!key) return false;
  const current = snapshots.get(key);
  if (current && capturedTime(snapshot) < capturedTime(current)) return false;
  snapshots.set(key, snapshot);
  listeners.get(key)?.forEach((listener) => listener());
  return true;
};

export const applyAgentTeamsChildProjection = (
  rootSessionId: string,
  projection: Record<string, any>,
  envelopeStreamId?: string
) => {
  const key = `${rootSessionId}`;
  const current = snapshots.get(key);
  if (!current) return false;

  let metadata: Record<string, any>;
  try {
    metadata =
      typeof projection.metadata === 'string' ? JSON.parse(projection.metadata || '{}') : projection.metadata || {};
  } catch {
    return false;
  }
  if (metadata.session_scope !== 'child') return false;
  if (metadata.external_parent_session_id && `${metadata.external_parent_session_id}` !== key) return false;

  const externalSessionId = `${metadata.external_session_id || ''}`;
  const byclawSessionId = `${projection.sessionId || ''}`;
  const members = current.team.members || [];
  const memberIndex = members.findIndex(
    (member) => `${member.id}` === externalSessionId || `${member.byclawSessionId || ''}` === byclawSessionId
  );
  if (memberIndex < 0) return false;

  const member = members[memberIndex];
  const childRun = getScopedChildRunState(projection, envelopeStreamId);
  const currentRun = member.childRunId
    ? {
      childRunId: member.childRunId,
      childTurn: member.childTurn,
      lastStreamId: member.lastStreamId,
      running: member.activity === 'working',
    }
    : undefined;
  if (!shouldApplyScopedChildRun(currentRun, childRun)) return false;

  const nextMembers = [...members];
  nextMembers[memberIndex] = {
    ...member,
    status: `${metadata.session_status || (childRun.running ? 'running' : member.status || 'completed')}`,
    activity: childRun.running ? 'working' : 'idle',
    currentTask: metadata.child_task || member.currentTask,
    childRunId: childRun.childRunId,
    childTurn: childRun.childTurn,
    lastStreamId: childRun.lastStreamId,
  };
  snapshots.set(key, {
    ...current,
    team: { ...current.team, members: nextMembers },
  });
  listeners.get(key)?.forEach((listener) => listener());
  return true;
};

const subscribe = (rootSessionId: string, listener: () => void) => {
  const key = `${rootSessionId}`;
  const current = listeners.get(key) || new Set<() => void>();
  current.add(listener);
  listeners.set(key, current);
  return () => {
    current.delete(listener);
    if (current.size === 0) listeners.delete(key);
  };
};

export const useAgentTeamsSnapshot = (rootSessionId: string) =>
  useSyncExternalStore(
    (listener) => subscribe(rootSessionId, listener),
    () => getAgentTeamsSnapshot(rootSessionId),
    () => getAgentTeamsSnapshot(rootSessionId)
  );

export const clearAgentTeamsSnapshots = () => {
  snapshots.clear();
  listeners.forEach((entries) => entries.forEach((listener) => listener()));
};
