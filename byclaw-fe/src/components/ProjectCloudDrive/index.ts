import { ensureDirectoryPath, normalizeFileBrowserPath } from '@/layout/sider/components/FileSiderPanel/utils';
import { queryDirAndFileByLevel } from '@/service/knowledgeCenter';

export interface ProjectCloudDriveItem {
  name: string;
  path: string;
  isDir: boolean;
  fileId?: number;
  fileUrl?: string;
  size?: number;
  updatedAt?: string;
  createBy?: string | number | null;
  createStaffName?: string | null;
}

/** 统一项目云盘接口记录到文件树所使用的路径语义。 */
export const normalizeProjectCloudDriveItem = (item: any, fallbackDirectoryPath = '/'): ProjectCloudDriveItem => {
  const rawName = `${item?.fileName || item?.name || '文件'}`.trim();
  // 接口返回的 fileName 偶尔是完整路径；列表展示和预览参数只使用当前节点名称。
  const name = rawName.split('/').filter(Boolean).at(-1) || rawName;
  const directoryPath = normalizeFileBrowserPath(item?.directoryPath || fallbackDirectoryPath || '/');
  const normalizedDirectoryPath = directoryPath === '/' ? '/' : directoryPath.replace(/\/$/, '');
  // fileBrowser 接口返回的 directoryPath 是当前节点完整路径；旧数据也可能只返回父目录，按末级名称兼容两种格式。
  const rawPath =
    normalizedDirectoryPath === '/' || normalizedDirectoryPath.split('/').filter(Boolean).at(-1) !== name
      ? `${normalizedDirectoryPath === '/' ? '' : normalizedDirectoryPath}/${name}`
      : normalizedDirectoryPath;
  const path = normalizeFileBrowserPath(rawPath);
  const itemType = `${item?.type || item?.fileType || item?.resourceType || ''}`.toLowerCase();
  const isDir =
    item?.isDir === true ||
    item?.isDir === 'true' ||
    item?.dir === true ||
    item?.dir === 'true' ||
    itemType === 'directory' ||
    itemType === 'folder' ||
    itemType === 'dir';
  return {
    name,
    path: isDir ? ensureDirectoryPath(path) : path,
    isDir,
    fileId: item?.fileId ?? item?.id,
    fileUrl: item?.fileUrl || '',
    size: item?.size,
    updatedAt: item?.updatedAt,
    createBy: item?.createBy,
    createStaffName: item?.createStaffName,
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
