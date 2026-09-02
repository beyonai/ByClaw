import type { FileBrowserItem } from '@/service/fileBrowser';
import { filterSessionRootItems } from '../sessionResourceUtils';

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
