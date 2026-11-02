import type { FileBrowserItem } from '@/service/fileBrowser';
import {
  CANONICAL_SESSION_ROOT,
  appendProjectSessionsDirectory,
  filterSessionRootItems,
} from '../sessionResourceUtils';

describe('filterSessionRootItems', () => {
  it('removes repository directories from the session root while keeping other files', () => {
    const items: FileBrowserItem[] = [
      { name: 'ByClaw', path: '/.sessions/301/ByClaw/', isDir: true },
      { name: 'notes', path: '/.sessions/301/notes/', isDir: true },
      { name: 'README.md', path: '/.sessions/301/README.md', isDir: false },
    ];

    expect(filterSessionRootItems(items, [{ repoFullName: 'beyonai/ByClaw' }])).toEqual(items.slice(1));
  });
});

describe('project session virtual directory', () => {
  it('pins one virtual process-files directory to the top and points it at the current session', () => {
    const files = [{ name: 'README.md', path: '/by/.shared/project_12/README.md', isDir: false }] as any;
    expect(appendProjectSessionsDirectory(files, '8798')).toEqual([
      { name: '.sessions', path: `${CANONICAL_SESSION_ROOT}8798/`, isDir: true },
      ...files,
    ]);
  });
});
