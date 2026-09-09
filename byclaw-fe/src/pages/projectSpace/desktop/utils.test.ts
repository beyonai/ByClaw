import { getDirectoryName, mergeLocalDirectories, removeLocalDirectory, setPrimaryLocalDirectory } from './utils';

describe('desktop project directories', () => {
  it('extracts directory names from Windows and macOS paths', () => {
    expect(getDirectoryName('/Users/test/byclaw-desktop/')).toBe('byclaw-desktop');
    expect(getDirectoryName('C:\\workspace\\byclaw-harness\\')).toBe('byclaw-harness');
    expect(getDirectoryName('/')).toBe('/');
    expect(getDirectoryName('C:\\')).toBe('C:\\');
  });

  it('deduplicates Windows paths without changing the first primary directory', () => {
    const directories = mergeLocalDirectories([], ['C:\\Work', 'c:\\work', 'D:\\Code'], 'win32');

    expect(directories).toEqual([
      { name: 'Work', path: 'C:\\Work', primary: true },
      { name: 'Code', path: 'D:\\Code', primary: false },
    ]);
  });

  it('moves the primary marker and assigns a replacement after removal', () => {
    const directories = mergeLocalDirectories([], ['/work/main', '/work/secondary'], 'darwin');
    const changed = setPrimaryLocalDirectory(directories, '/work/secondary');
    const remaining = removeLocalDirectory(changed, '/work/secondary');

    expect(remaining).toEqual([{ name: 'main', path: '/work/main', primary: true }]);
  });
});
