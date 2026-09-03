import { getSessionFileTabKeys } from '../resourceTabUtils';

describe('getSessionFileTabKeys', () => {
  it('keeps local shared files and hides project cloud drive for the default project', () => {
    expect(getSessionFileTabKeys(-1)).toEqual(['file', 'sharedFile']);
  });

  it('keeps local shared files and adds project cloud drive for a normal project', () => {
    expect(getSessionFileTabKeys(10001)).toEqual(['file', 'sharedFile', 'projectFile']);
  });
});
