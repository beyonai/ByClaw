import { isCurrentUserTaskAssignee } from '../taskAccess';

describe('isCurrentUserTaskAssignee', () => {
  it('matches the task creator when the assignee id is unavailable', () => {
    expect(isCurrentUserTaskAssignee({ createBy: 1001 }, { userId: 1001 })).toBe(true);
    expect(isCurrentUserTaskAssignee({ createBy: 1002 }, { userId: 1001 })).toBe(false);
  });

  it('falls back to the assignee name only when ids are unavailable', () => {
    expect(isCurrentUserTaskAssignee({ assignee: '刘皇叔' }, { userName: '刘皇叔' })).toBe(true);
    expect(isCurrentUserTaskAssignee({ assignee: '梁小' }, { userName: '刘皇叔' })).toBe(false);
  });
});
