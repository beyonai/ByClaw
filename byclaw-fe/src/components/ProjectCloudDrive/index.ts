import { ensureDirectoryPath, normalizeFileBrowserPath } from '@/layout/sider/components/FileSiderPanel/utils';
import { queryDirAndFileByLevel } from '@/service/knowledgeCenter';

export interface ProjectCloudDriveItem {
  name: string;
  path: string;
  isDir: boolean;
  fileId?: number;
  fileUrl?: string;
  size?: number;
}

/** 统一项目云盘接口记录到文件树所使用的路径语义。 */
export const normalizeProjectCloudDriveItem = (item: any, fallbackDirectoryPath = '/'): ProjectCloudDriveItem => {
  const name = `${item?.fileName || item?.name || '文件'}`.trim();
  const directoryPath = normalizeFileBrowserPath(item?.directoryPath || fallbackDirectoryPath || '/');
  let parentPath = directoryPath === '/' ? '/' : directoryPath.replace(/\/$/, '');
  // 兼容接口偶发把当前文件名重复拼到 directoryPath 的情况（如 /a.txt/a.txt）。
  const pathSegments = parentPath.split('/').filter(Boolean);
  if (pathSegments.length >= 2 && pathSegments.at(-1) === name && pathSegments.at(-2) === name) {
    pathSegments.pop();
    parentPath = `/${pathSegments.join('/')}`;
  }
  const rawPath =
    parentPath.endsWith(`/${name}`) || parentPath === `/${name}`
      ? parentPath
      : `${parentPath === '/' ? '' : parentPath}/${name}`;
  const path = normalizeFileBrowserPath(rawPath);
  const isDir = item?.type === 'directory';
  return {
    name,
    path: isDir ? ensureDirectoryPath(path) : path,
    isDir,
    fileId: item?.fileId ?? item?.id,
    fileUrl: item?.fileUrl || '',
    size: item?.size,
  };
};

/** 会话详情和项目详情共用项目云盘目录查询。 */
export const queryProjectCloudDrive = async (resourceId: string | number, directoryPath = '/', language?: string) => {
  const normalizedPath = ensureDirectoryPath(normalizeFileBrowserPath(directoryPath));
  const response = await queryDirAndFileByLevel({
    resourceId: Number(resourceId),
    directoryPath: normalizedPath,
    language,
  });
  return (response || []).map((item: any) => normalizeProjectCloudDriveItem(item, normalizedPath));
};
