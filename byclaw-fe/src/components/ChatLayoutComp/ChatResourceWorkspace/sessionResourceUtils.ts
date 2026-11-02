import type { FileBrowserItem } from '@/service/fileBrowser';
import type { DevloopProjectRepo } from '@/service/devloop';
import { isDirectory } from '@/layout/sider/components/FileSiderPanel/utils';

// 会话根目录同时包含普通会话文件和项目仓库目录；仓库目录由代码页签单独展示。
export const filterSessionRootItems = (items: FileBrowserItem[], repos: Pick<DevloopProjectRepo, 'repoFullName'>[]) => {
  const repoNames = new Set(
    repos.map((repo) => repo.repoFullName?.trim().replace(/\/+$/, '').split('/').filter(Boolean).pop()).filter(Boolean)
  );
  return items.filter((item) => !isDirectory(item) || !repoNames.has(item.name));
};

type SessionDisplayMetadata = {
  sessionId: string | number;
  sessionName?: string;
};

export const CANONICAL_SESSION_ROOT = '/by/.sessions/';

export const createProjectSessionItems = (sessions: SessionDisplayMetadata[]): FileBrowserItem[] =>
  sessions.map(({ sessionId }) => ({
    name: `${sessionId}`,
    path: `${CANONICAL_SESSION_ROOT}${sessionId}/`,
    isDir: true,
  }));

export const appendProjectSessionsDirectory = (items: FileBrowserItem[]): FileBrowserItem[] => [
  ...items.filter((item) => item.name !== '.sessions'),
  { name: '.sessions', path: CANONICAL_SESSION_ROOT, isDir: true },
];

/** Resolve only the label; the physical name and path remain stable for browsing and quoting. */
export const resolveProjectSessionDisplayName = (
  item: FileBrowserItem,
  sessions: SessionDisplayMetadata[]
) => {
  if (!isDirectory(item)) return item.name;
  const match = /^\/by\/\.sessions\/([^/]+)\/?$/.exec(item.path);
  if (!match) return item.name;
  const session = sessions.find(({ sessionId }) => `${sessionId}` === match[1]);
  return session?.sessionName?.trim() || item.name;
};
