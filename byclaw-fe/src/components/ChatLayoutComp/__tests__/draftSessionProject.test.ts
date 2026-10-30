import {
  buildDraftSessionProjectPatch,
  resolvePendingSessionProjectId,
  shouldPersistDraftSessionProject,
} from '../draftSessionProject';

describe('shouldPersistDraftSessionProject', () => {
  it('persists only an upload-created session that is still displayed as a new task', () => {
    expect(
      shouldPersistDraftSessionProject({ preserveNewSessionView: true, isBottom: false, sessionId: '101' })
    ).toBe(true);
    expect(shouldPersistDraftSessionProject({ preserveNewSessionView: true, isBottom: true, sessionId: '101' })).toBe(
      false
    );
    expect(shouldPersistDraftSessionProject({ preserveNewSessionView: true, isBottom: false, sessionId: '' })).toBe(
      false
    );
    expect(shouldPersistDraftSessionProject({ preserveNewSessionView: false, isBottom: false, sessionId: '101' })).toBe(
      false
    );
  });

  it('updates the cached session after the draft project is persisted', () => {
    expect(
      buildDraftSessionProjectPatch('101', {
        projectId: '11197274',
        projectName: '研发项目',
        cloudResourceId: '300',
      })
    ).toEqual({
      sessionId: '101',
      projectId: 11197274,
      projectName: '研发项目',
      cloudResourceId: '300',
    });
  });

  it('prefers the newly selected project when an upload creates a pending session', () => {
    expect(resolvePendingSessionProjectId(-1, '11197274')).toBe('11197274');
    expect(resolvePendingSessionProjectId(-1, undefined)).toBe(-1);
  });
});
