import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

import AgentTeamsActivity, { isAgentTeamsSnapshot } from '../AgentTeamsActivity';
import { clearAgentTeamsSnapshots, getAgentTeamsSnapshot, publishAgentTeamsSnapshot } from '../agentTeamsStore';

jest.mock('@/hooks/useGlobal', () => () => ({ sessionId: '100' }));

const snapshot = {
  source: 'EXTERNAL',
  schemaVersion: 2,
  eventKind: 'agent-teams/snapshot',
  archived: false,
  capturedAt: '2026-08-28T08:00:00.000Z',
  team: {
    teamId: 'team-1',
    name: 'ByClaw研发专家团',
    captainSessionId: 'external-root-1',
    members: [],
    tasks: [],
    messageCount: 0,
    captainInbox: [],
  },
} as const;

describe('AgentTeamsActivity snapshot sink', () => {
  beforeEach(clearAgentTeamsSnapshots);

  it('recognizes only schema-v2 AgentTeams snapshots', () => {
    expect(isAgentTeamsSnapshot(snapshot)).toBe(true);
    expect(isAgentTeamsSnapshot({ ...snapshot, schemaVersion: 1 })).toBe(false);
    expect(isAgentTeamsSnapshot({ ...snapshot, eventKind: 'tool.call' })).toBe(false);
  });

  it('captures the latest snapshot without rendering a conversation card', async () => {
    const { container } = render(<AgentTeamsActivity snapshot={snapshot} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('ByClaw研发专家团')).not.toBeInTheDocument();
    await waitFor(() => expect(getAgentTeamsSnapshot('100')).toEqual(snapshot));
  });

  it('does not let an older capturedAt overwrite the newest snapshot', () => {
    publishAgentTeamsSnapshot('100', { ...snapshot, capturedAt: '2026-08-28T08:02:00.000Z', archived: true });
    publishAgentTeamsSnapshot('100', snapshot);
    expect(getAgentTeamsSnapshot('100')?.archived).toBe(true);
  });
});
