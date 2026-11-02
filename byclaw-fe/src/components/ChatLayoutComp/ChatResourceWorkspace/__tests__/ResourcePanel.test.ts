import {
  getSessionFileTabKeys,
  getSessionResourceTabKeys,
  getVisibleSessionFileTabKeys,
  getVisibleSessionResourceTabKeys,
} from '../resourceTabUtils';

describe('getVisibleSessionFileTabKeys', () => {
  it('hides process files until the runtime is known', () => {
    expect(getVisibleSessionFileTabKeys(['file', 'sharedFile'], 'unknown')).toEqual(['sharedFile']);
  });

  it('hides process files for DSH while preserving shared files', () => {
    expect(getVisibleSessionFileTabKeys(['file', 'sharedFile', 'projectFile'], 'dsh')).toEqual([
      'sharedFile',
      'projectFile',
    ]);
  });
});

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

describe('getVisibleSessionResourceTabKeys', () => {
  it('uses the same DSH visibility for the resource menu and the right panel', () => {
    expect(getVisibleSessionResourceTabKeys(['file', 'sharedFile', 'projectFile', 'code'], 'dsh')).toEqual([
      'sharedFile',
      'projectFile',
    ]);
  });

  it('keeps process files for OpenClaw while project space is paused', () => {
    expect(getVisibleSessionResourceTabKeys(['file', 'sharedFile', 'projectFile', 'code'], 'openclaw')).toEqual([
      'file',
      'sharedFile',
      'projectFile',
    ]);
  });
});
