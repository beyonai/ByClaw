import React from 'react';

import useGlobal from '@/hooks/useGlobal';

import { publishAgentTeamsSnapshot } from './agentTeamsStore';

export interface AgentTeamsMember {
  id: string;
  byclawSessionId?: string;
  name: string;
  role?: string;
  status?: string;
  activity?: 'working' | 'idle' | 'unknown';
  progress?: number;
  done?: number;
  total?: number;
  currentTask?: string;
  unread?: number;
}

export interface AgentTeamsTask {
  id: string;
  subject: string;
  status?: string;
  state?: 'blocked' | 'open' | 'running' | 'completed';
  assignee?: string;
  dependencies?: string[];
  depth?: number;
}

export interface AgentTeamsSnapshot {
  source?: string;
  schemaVersion: 2;
  eventKind: 'agent-teams/snapshot';
  archived?: boolean;
  capturedAt?: string;
  team: {
    teamId: string;
    name?: string;
    description?: string;
    captainSessionId: string;
    members?: AgentTeamsMember[];
    tasks?: AgentTeamsTask[];
    messageCount?: number;
    captainInbox?: Array<{ from: string; content: string }>;
  };
}

export const isAgentTeamsSnapshot = (value: unknown): value is AgentTeamsSnapshot => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.schemaVersion === 2 &&
    candidate.eventKind === 'agent-teams/snapshot' &&
    Boolean(candidate.team && typeof candidate.team === 'object')
  );
};

/** Conversation snapshots update the shared header state and render no body card. */
function AgentTeamsActivity({ snapshot, rootSessionId }: { snapshot: AgentTeamsSnapshot; rootSessionId?: string }) {
  const { sessionId } = useGlobal();

  React.useEffect(() => {
    const owner = rootSessionId || `${sessionId || ''}`;
    if (owner) publishAgentTeamsSnapshot(owner, snapshot);
  }, [rootSessionId, sessionId, snapshot]);

  return null;
}

export default AgentTeamsActivity;
