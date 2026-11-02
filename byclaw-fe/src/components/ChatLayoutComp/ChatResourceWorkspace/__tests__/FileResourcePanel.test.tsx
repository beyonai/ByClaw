import type { FileBrowserItem } from '@/service/fileBrowser';
import {
  CANONICAL_SESSION_ROOT,
  appendProjectSessionsDirectory,
  createProjectSessionItems,
  filterSessionRootItems,
  mergeProjectSessionMetadata,
  resolveProjectSessionDisplayName,
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

describe('resolveProjectSessionDisplayName', () => {
  const sessions = [
    { sessionId: '8798', sessionName: '你好' },
    { sessionId: '9103', sessionName: '销售分析' },
  ];

  it('shows the session name without changing the session directory path', () => {
    const item = {
      name: '8798',
      path: '/by/.sessions/8798/',
      isDir: true,
    } as any;

    expect(resolveProjectSessionDisplayName(item, sessions)).toBe('你好');
    expect(item.name).toBe('8798');
    expect(item.path).toBe('/by/.sessions/8798/');
  });

  it('keeps the physical name outside canonical sessions or when metadata is unavailable', () => {
    expect(
      resolveProjectSessionDisplayName(
        { name: 'other', path: '/by/other/', isDir: true } as any,
        sessions
      )
    ).toBe('other');
    expect(
      resolveProjectSessionDisplayName(
        { name: 'missing', path: '/by/.sessions/missing/', isDir: true } as any,
        sessions
      )
    ).toBe('missing');
  });
});

describe('project session virtual directory', () => {
  it('fills missing project session names from the live session list', () => {
    expect(
      mergeProjectSessionMetadata(
        [
          { sessionId: '11407993', sessionName: '' },
          { sessionId: '11409730', sessionName: undefined },
          { sessionId: 'employee', sessionName: '员工问候开场' },
        ],
        [
          { sessionId: '11407993', sessionName: '你好' },
          { sessionId: '11409730', sessionName: '文件上传' },
          { sessionId: 'other-project', sessionName: '其他项目会话' },
        ]
      )
    ).toEqual([
      { sessionId: '11407993', sessionName: '你好' },
      { sessionId: '11409730', sessionName: '文件上传' },
      { sessionId: 'employee', sessionName: '员工问候开场' },
    ]);
  });

  it('adds one virtual .sessions directory without depending on a filesystem entry', () => {
    const files = [{ name: 'README.md', path: '/by/.shared/project_12/README.md', isDir: false }] as any;
    expect(appendProjectSessionsDirectory(files)).toEqual([
      ...files,
      { name: '.sessions', path: CANONICAL_SESSION_ROOT, isDir: true },
    ]);
  });

  it('uses bare session ids as canonical directory names', () => {
    expect(createProjectSessionItems([{ sessionId: '8798', sessionName: '你好' }])).toEqual([
      { name: '8798', path: '/by/.sessions/8798/', isDir: true },
    ]);
  });
});
