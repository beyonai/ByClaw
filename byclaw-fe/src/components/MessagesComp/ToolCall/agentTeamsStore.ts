import { useSyncExternalStore } from 'react';

import type { AgentTeamsSnapshot } from './AgentTeamsActivity';

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
