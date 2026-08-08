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
