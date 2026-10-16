import {
  DESKTOP_UNASSIGNED_SESSION_SCOPE,
  hasDesktopTaskSessions,
  sortWorkspaceSessions,
  syncWorkspaceSessionActivity,
} from '../workspaceSiderState';

describe('workspace sider desktop task visibility', () => {
  it('shows the task directory only when desktop unassigned sessions exist', () => {
    expect(hasDesktopTaskSessions(true, { sessions: [{ sessionId: 's1' }], total: 1 })).toBe(true);
    expect(hasDesktopTaskSessions(true, { sessions: [], total: 0 })).toBe(false);
    expect(hasDesktopTaskSessions(false, { sessions: [{ sessionId: 's1' }], total: 1 })).toBe(false);
    expect(DESKTOP_UNASSIGNED_SESSION_SCOPE).toBe('__desktop_unassigned_sessions__');
  });
});

describe('workspace session activity ordering', () => {
  const sessions = [
    { sessionId: 'newer', sessionName: 'Newer', projectId: 'p1', updateTime: '2026-10-10T00:00:00Z' },
    { sessionId: 'history', sessionName: 'History', projectId: 'p1', updateTime: '2026-10-08T00:00:00Z' },
  ];

  it('moves a historical session to the front as soon as its message summary updates', () => {
    const updateTime = `${Date.parse('2026-10-15T00:00:00Z')}`;
    const result = syncWorkspaceSessionActivity(sessions, [
      { sessionId: 'history', updateTime, sessionContent: '11' },
      { sessionId: 'other-project', updateTime },
    ]);

    expect(result.map((session) => session.sessionId)).toEqual(['history', 'newer']);
    expect(result[0]).toEqual({ ...sessions[1], updateTime, sessionContent: '11' });
    expect(sessions[1].updateTime).toBe('2026-10-08T00:00:00Z');
    expect(result).toHaveLength(sessions.length);
  });

  it('does not promote a session merely opened with unchanged or older history', () => {
    expect(
      syncWorkspaceSessionActivity(sessions, [
        { sessionId: 'history', updateTime: sessions[1].updateTime },
        { sessionId: 'newer', updateTime: '2026-10-01T00:00:00Z' },
      ])
    ).toEqual(sessions);
  });

  it('keeps current activity ahead of a stale list response and preserves the project metadata', () => {
    const liveSessions = [{ sessionId: 'history', updateTime: '2026-10-15T00:00:00Z' }];
    const refreshed = sessions.map((session) => ({ ...session, sessionName: `${session.sessionName} renamed` }));
    const result = syncWorkspaceSessionActivity(refreshed, liveSessions);

    expect(result[0]).toMatchObject({
      sessionId: 'history',
      sessionName: 'History renamed',
      projectId: 'p1',
      updateTime: liveSessions[0].updateTime,
    });
  });

  it('sorts numeric timestamps and date strings together with creation-time fallback', () => {
    const input = [
      { sessionId: 'invalid', sessionName: '', updateTime: 'invalid' },
      { sessionId: 'date', sessionName: '', updateTime: '2026-10-10T00:00:00Z' },
      { sessionId: 'created', sessionName: '', createTime: '2026-10-12T00:00:00Z' },
      { sessionId: 'timestamp', sessionName: '', updateTime: `${Date.parse('2026-10-15T00:00:00Z')}` },
    ];
    expect(sortWorkspaceSessions(input).map((session) => session.sessionId)).toEqual([
      'timestamp',
      'created',
      'date',
      'invalid',
    ]);
    expect(input[0].sessionId).toBe('invalid');
  });
});
