import { DESKTOP_UNASSIGNED_SESSION_SCOPE, hasDesktopTaskSessions } from '../workspaceSiderState';

describe('workspace sider desktop task visibility', () => {
  it('shows the task directory only when desktop unassigned sessions exist', () => {
    expect(hasDesktopTaskSessions(true, { sessions: [{ sessionId: 's1' }], total: 1 })).toBe(true);
    expect(hasDesktopTaskSessions(true, { sessions: [], total: 0 })).toBe(false);
    expect(hasDesktopTaskSessions(false, { sessions: [{ sessionId: 's1' }], total: 1 })).toBe(false);
    expect(DESKTOP_UNASSIGNED_SESSION_SCOPE).toBe('__desktop_unassigned_sessions__');
  });
});
