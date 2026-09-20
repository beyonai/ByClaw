import { getSessionFileTabKeys, getSessionResourceTabKeys } from '../resourceTabUtils';

describe('getSessionFileTabKeys', () => {
  it('keeps local shared files and hides project cloud drive for the default project', () => {
    expect(getSessionFileTabKeys(-1)).toEqual(['file', 'sharedFile']);
  });

  it('keeps local shared files and adds project cloud drive for a normal project', () => {
    expect(getSessionFileTabKeys(10001)).toEqual(['file', 'sharedFile', 'projectFile']);
  });
});

describe('getSessionResourceTabKeys', () => {
  it.each([undefined, NaN, -1])('hides project entries for project %s', (projectId) => {
    expect(getSessionResourceTabKeys(projectId, 'session-1')).toEqual(['file', 'sharedFile']);
  });

  it('shows project space only for an existing conversation in a positive project', () => {
    expect(getSessionResourceTabKeys(42)).toEqual(['file', 'sharedFile', 'projectFile']);
    expect(getSessionResourceTabKeys(42, 'session-1')).toEqual(['file', 'sharedFile', 'projectFile', 'code']);
  });
});
