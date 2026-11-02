import { renderHook } from '@testing-library/react';

import type { ProjectSpace } from '../../types';
import { useProjectSessions } from '../useProjectSessions';

describe('useProjectSessions', () => {
  it('orders API dates and live timestamps consistently with the sidebar', () => {
    const project = {
      projectId: 'p1',
      projectName: 'Project',
      sessions: [
        { sessionId: 'api', sessionName: 'API', updateTime: '2026-11-02 17:24:11' },
        { sessionId: 'live', sessionName: 'Live', updateTime: String(Date.parse('2026-11-02T09:25:00Z')) },
        { sessionId: 'created', sessionName: 'Created', createTime: '2026-11-02 17:24:30' },
      ],
    } as ProjectSpace;
    const { result } = renderHook(() => useProjectSessions(project));

    expect(result.current.sessions.map((session) => session.sessionId)).toEqual(['live', 'created', 'api']);
    expect(result.current.total).toBe(3);
    expect(project.sessions?.[0].sessionId).toBe('api');
  });
});
