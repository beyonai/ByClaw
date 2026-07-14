import { PROJECT_FILE_PATH } from '../constants';
import {
  getCategoryRootPath,
  getDisplayFileBrowserPath,
  getFileCategoryKeyByPath,
  isProtectedRootDirectory,
} from '../utils';

describe('FileSiderPanel project space paths', () => {
  it('maps project paths to the project category', () => {
    expect(getCategoryRootPath('project')).toBe(PROJECT_FILE_PATH);
    expect(getFileCategoryKeyByPath('/.project/demo/readme.md')).toBe('project');
    expect(getDisplayFileBrowserPath(PROJECT_FILE_PATH)).toBe('/by/.project/');
  });

  it('protects the project root directory from rename and delete actions', () => {
    expect(
      isProtectedRootDirectory({
        name: '.project',
        path: PROJECT_FILE_PATH,
        isDir: true,
      })
    ).toBe(true);
  });
});
