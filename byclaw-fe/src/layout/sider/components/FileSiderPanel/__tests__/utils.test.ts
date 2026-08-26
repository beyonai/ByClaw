import { PROJECT_FILE_PATH } from '../constants';
import {
  canPreviewFile,
  getCategoryRootPath,
  getDisplayFileBrowserPath,
  getFileCategoryKeyByPath,
  getPreviewFileType,
  MAX_TEXT_PREVIEW_SIZE,
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

  it('previews extensionless repository metadata as text', () => {
    expect(canPreviewFile({ name: '.gitattributes', path: '/.gitattributes', isDir: false })).toBe(true);
    expect(canPreviewFile({ name: '.gitmodules', path: '/.gitmodules', isDir: false })).toBe(true);
    expect(getPreviewFileType('.gitignore')).toBe('txt');
  });

  it('rejects oversized text files while keeping binary files on their existing preview rules', () => {
    expect(
      canPreviewFile({ name: '.gitignore', path: '/.gitignore', isDir: false, size: MAX_TEXT_PREVIEW_SIZE + 1 })
    ).toBe(false);
    expect(canPreviewFile({ name: 'archive.zip', path: '/archive.zip', isDir: false })).toBe(false);
  });
});
