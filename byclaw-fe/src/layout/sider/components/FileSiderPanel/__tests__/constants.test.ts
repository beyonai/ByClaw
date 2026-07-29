import { PROJECT_FILE_PATH, getVisibleFileCategories } from '../constants';

describe('FileSiderPanel categories', () => {
  it('shows standard spaces in the requested order for regular users', () => {
    expect(getVisibleFileCategories(false).map((category) => category.key)).toEqual(['session', 'shared', 'project']);
  });

  it('adds admin-only spaces in the requested order for adminvip users', () => {
    expect(getVisibleFileCategories(true).map((category) => category.key)).toEqual([
      'session',
      'shared',
      'project',
      'log',
      'root',
    ]);
  });

  it('configures project space with its protected path and upload placeholder', () => {
    const project = getVisibleFileCategories(false).find((category) => category.key === 'project');

    expect(project).toMatchObject({
      path: PROJECT_FILE_PATH,
      ensure: true,
      uploadUnderConstruction: true,
    });
  });
});
