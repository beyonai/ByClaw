import type { FileBrowserItem } from '@/service/fileBrowser';
import { filterSessionRootItems, resolveProjectSessionDisplayName } from '../sessionResourceUtils';

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

describe('resolveProjectSessionDisplayName', () => {
  const sessions = [
    { sessionId: '8798', sessionName: '你好' },
    { sessionId: '9103', sessionName: '销售分析' },
  ];

  it('shows the session name without changing the session directory path', () => {
    const item = {
      name: 'session_8798',
      path: '/by/.shared/project_-1/.sessions/session_8798/',
      isDir: true,
    } as any;

    expect(resolveProjectSessionDisplayName(item, sessions)).toBe('你好');
    expect(item.name).toBe('session_8798');
    expect(item.path).toBe('/by/.shared/project_-1/.sessions/session_8798/');
  });

  it('keeps the physical name outside project session aliases or when metadata is unavailable', () => {
    expect(
      resolveProjectSessionDisplayName(
        { name: 'session_8798', path: '/by/.sessions/8798/', isDir: true } as any,
        sessions
      )
    ).toBe('session_8798');
    expect(
      resolveProjectSessionDisplayName(
        { name: 'session_missing', path: '/by/.shared/project_-1/.sessions/session_missing/', isDir: true } as any,
        sessions
      )
    ).toBe('session_missing');
  });
});
