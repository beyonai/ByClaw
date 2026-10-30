import { shouldPersistDraftSessionProject } from '../draftSessionProject';

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
});
