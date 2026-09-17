import React, { useCallback, useEffect, useMemo, useRef, useState, type Key } from 'react';
import { Button, Dropdown, Empty, Modal, Spin, Tooltip, Tree, Typography, Upload, message, type MenuProps } from 'antd';
import { EllipsisOutlined, FolderAddOutlined, UploadOutlined } from '@ant-design/icons';
import { getLocale, useIntl, useSelector } from '@umijs/max';
import FileSpaceBlock from '@/layout/sider/components/FileSiderPanel/components/FileSpaceBlock';
import { FilePathTooltip } from '@/layout/sider/components/FileSiderPanel/components/FileTreeList';
import CreateFolderModal from '@/layout/sider/components/FileSiderPanel/components/CreateFolderModal';
import {
  DISPLAY_FILE_PATH_PREFIX,
  SHARED_FILE_PATH,
  type FileTreeItem,
} from '@/layout/sider/components/FileSiderPanel/constants';
import {
  canPreviewFile,
  ensureDirectoryPath,
  getParentDirectoryPath,
  getSessionFilePath,
  isDirectory,
  normalizeFileBrowserPath,
  normalizeReferenceItem,
  sortFileBrowserItems,
  unwrapListResponse,
} from '@/layout/sider/components/FileSiderPanel/utils';
import employeeStyles from '@/layout/sider/components/EmployeeList/index.module.less';
import RenameModal from '@/components/QueryInput/components/FileBrowserEntry/components/FileBrowserPanel/RenameModal';
import { DragType } from '@/components/QueryInput/withDrag';
import useGlobal from '@/hooks/useGlobal';
import type { ProjectSpace } from '@/pages/projectSpace/types';
import {
  deleteProjectSpaceFile,
  listProjectRepos,
  type DevloopProjectRepo,
  renameProjectSpaceFile,
} from '@/service/devloop';
import {
  copyFile,
  deleteFiles,
  ensureFolder,
  downloadFile,
  downloadFolder,
  createFolder,
  listFiles,
  renameFile,
  uploadFiles,
  type FileBrowserItem,
} from '@/service/fileBrowser';
import {
  createFolder as createKnowledgeFolder,
  deleteFolder,
  moveKnowledgeItems,
  removeFile,
  renameFolder,
  updateFileInfo,
  uploadFiles as uploadKnowledgeFiles,
} from '@/service/knowledgeCenter';
import { downloadFile as downloadUrlFile } from '@/utils/file';
import { downloadResourceFile } from '@/service/file';
import type { DetailPanelOptions } from '@/layout/sider/siderContentContext';
import FilePreviewPanel from './FilePreviewPanel';
import projectStyles from '@/pages/projectSpace/index.module.less';
import { useInfiniteScroll } from '@/pages/projectSpace/hooks/useInfiniteScroll';
import { filterSessionRootItems } from './sessionResourceUtils';
import styles from './index.module.less';
import { queryProjectCloudDrive } from '@/components/ProjectCloudDrive';
import { useChatResourceProject } from './useChatResourceProject';

type ProjectFileItem = FileBrowserItem & {
  fileId: number;
  fileUrl: string;
  updatedAt?: string;
  createBy?: string | number | null;
  createStaffName?: string | null;
};

interface FileResourcePanelProps {
  scope: 'session' | 'shared' | 'project';
  sessionId: string;
  projectId?: number;
  project?: ProjectSpace;

  /** 过程文件保存到项目云盘时使用的目标知识库 ID。 */
  projectCloudResourceId?: string | number;
  resourceId?: string;
  refreshKey?: number;
  onOpenDetail: (panel: React.ReactNode, options: DetailPanelOptions) => void;
  onPreviewFile?: (item: FileBrowserItem) => void;
  // 项目大详情使用卡片视图；会话资源继续复用原文件树交互。
  cardMode?: boolean;

  /** 项目详情标题栏已有上传/新建入口时，隐藏文件树上方的重复工具栏。 */
  hideProjectToolbar?: boolean;

  /** 项目详情右侧空态使用紧凑高度。 */
  compactResourceEmpty?: boolean;
}

// 项目共享文件接口没有 FileBrowserItem 的目录字段，转换后即可复用左侧文件树及操作菜单。
const isProjectFile = (item: FileBrowserItem): item is ProjectFileItem => Number.isFinite((item as any).fileId);

const FileResourcePanel: React.FC<FileResourcePanelProps> = ({
  scope,
  sessionId,
  projectId: projectIdProp,
  project,
  projectCloudResourceId: projectCloudResourceIdProp,
  resourceId,
  refreshKey = 0,
  onOpenDetail,
  onPreviewFile,
  cardMode = false,
  hideProjectToolbar = false,
  compactResourceEmpty = false,
}) => {
  const intl = useIntl();
  const language = getLocale();
  const { project: loadedProject } = useChatResourceProject(!project && projectIdProp ? projectIdProp : undefined);
  const resolvedProject = project || loadedProject;
  const { EventEmitter } = useGlobal();
  const userInfo = useSelector((state: any) => state.user.userInfo);
  const [items, setItems] = useState<FileBrowserItem[]>([]);
  const [childrenByPath, setChildrenByPath] = useState<Record<string, FileBrowserItem[]>>({});
  // Tree 会缓存已触发过 loadData 的目录；刷新时必须同步清空，否则再次展开不会发起请求。
  const [loadedDirectoryKeys, setLoadedDirectoryKeys] = useState<Key[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<Key[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  const [renameTarget, setRenameTarget] = useState<FileBrowserItem | null>(null);
  const [renameLoading, setRenameLoading] = useState(false);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [createFolderName, setCreateFolderName] = useState('');
  const [createFolderPath, setCreateFolderPath] = useState('/');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [moveTarget, setMoveTarget] = useState<FileBrowserItem | null>(null);
  const [moveTargetDirectory, setMoveTargetDirectory] = useState('/');
  const [moving, setMoving] = useState(false);
  const [moveTreeData, setMoveTreeData] = useState<any[]>([]);
  const [moveTreeLoading, setMoveTreeLoading] = useState(false);
  const [saveDestination, setSaveDestination] = useState<'project' | 'shared'>('project');
  const [saveTarget, setSaveTarget] = useState<FileBrowserItem | null>(null);
  const [saveTargetPath, setSaveTargetPath] = useState('/');
  const [saveTreeData, setSaveTreeData] = useState<any[]>([]);
  const [saveExpandedKeys, setSaveExpandedKeys] = useState<Key[]>(['/']);
  const [saveTreeLoading, setSaveTreeLoading] = useState(false);
  const [savingResource, setSavingResource] = useState(false);
  // 保存目标与整句提示都由语言包翻译，避免拼接中文导致英文界面混用。
  const saveDestinationLabel = intl.formatMessage({
    id: saveDestination === 'project' ? 'chatResource.projectCloudDrive' : 'chatResource.localSharedFile',
  });
  const [visibleProjectItemCount, setVisibleProjectItemCount] = useState(20);
  const clickTimerRef = useRef<number | null>(null);
  // 项目详情异步加载期间也使用外部项目 ID，确保首次会话文件请求即可过滤仓库目录。
  const projectId = projectIdProp ?? Number(resolvedProject?.projectId);
  const projectCloudResourceId = projectCloudResourceIdProp || resolvedProject?.cloudResourceId;
  // 三类文件使用显式作用域，避免再根据项目 ID 推断本地共享文件和项目云盘的数据源。
  const usesFileBrowser = scope !== 'project';
  const rootPath =
    scope === 'project'
      ? '/'
      : `${DISPLAY_FILE_PATH_PREFIX}${scope === 'shared' ? SHARED_FILE_PATH : getSessionFilePath(sessionId)}`;
  const canManageProjectFiles = useMemo(() => {
    const currentUserId = userInfo?.userId ?? userInfo?.id;
    return (
      currentUserId !== undefined &&
      project?.createBy !== undefined &&
      project.createBy !== null &&
      `${currentUserId}` === `${project.createBy}`
    );
  }, [project?.createBy, userInfo?.id, userInfo?.userId]);

  const canDeleteProjectItem = useCallback(
    (item: FileBrowserItem) => {
      if (scope !== 'project') return true;
      const creatorName = (item as ProjectFileItem).createStaffName?.trim();
      if (!creatorName) return true;
      const currentUserId = userInfo?.userId ?? userInfo?.id;
      const creatorId = (item as ProjectFileItem).createBy;
      if (creatorId !== null && creatorId !== undefined && currentUserId !== undefined) {
        return `${creatorId}` === `${currentUserId}`;
      }
      return creatorName === `${userInfo?.userName || userInfo?.name || ''}`;
    },
    [scope, userInfo?.id, userInfo?.name, userInfo?.userId, userInfo?.userName]
  );

  const loadRoot = useCallback(async () => {
    if (scope === 'session' && (!resourceId || !sessionId)) {
      setItems([]);
      return;
    }
    // 项目云盘查询只依赖知识库 resourceId；新会话通过项目选择器进入时，projectId
    // 可能尚未同步，但只要已有 cloudResourceId 就应允许加载云盘内容。
    if (scope === 'project' && !resourceId) {
      setItems([]);
      return;
    }
    if (usesFileBrowser && !resourceId) {
      setItems([]);
      return;
    }

    // 刷新根目录时同时作废目录树缓存；否则 rc-tree 会认为已展开过的目录无需再次调用 loadData。
    setChildrenByPath({});
    setLoadedDirectoryKeys([]);
    setExpandedKeys([]);
    setLoading(true);
    setLoadError(undefined);
    try {
      if (scope === 'shared') {
        const response = await listFiles({ resourceId: resourceId!, path: rootPath, language });
        setItems(sortFileBrowserItems(unwrapListResponse<FileBrowserItem>(response)));
      } else if (scope === 'project') {
        const cloudItems = await queryProjectCloudDrive(resourceId, '/', language);
        setItems(sortFileBrowserItems(cloudItems));
      } else {
        // eslint-disable-next-line lines-around-comment
        // 文件与仓库并行查询，但等两者都结束后再更新列表，避免仓库目录先闪现后消失。
        const [filesResult, reposResult] = await Promise.allSettled([
          listFiles({ resourceId: resourceId!, path: rootPath, language }),
          projectId ? listProjectRepos(projectId) : Promise.resolve<DevloopProjectRepo[]>([]),
        ]);
        if (filesResult.status === 'rejected') throw filesResult.reason;
        const reposResponse =
          reposResult.status === 'fulfilled' && Array.isArray(reposResult.value) ? reposResult.value : [];
        if (reposResult.status === 'rejected') {
          // 仓库查询失败不应隐藏普通会话文件，代码页签仍可独立重试。
          console.error('Failed to load project repositories for session files:', reposResult.reason);
        }
        const files = unwrapListResponse<FileBrowserItem>(filesResult.value);
        setItems(sortFileBrowserItems(filterSessionRootItems(files, reposResponse)));
      }
    } catch (error) {
      console.error('Failed to load conversation resource files:', error);
      const responseError = error as { msg?: string; message?: string };
      const fallbackErrorMessage = intl.formatMessage({ id: `chatResource.loadFailed.${scope}` });
      const errorMessage =
        typeof error === 'string' ? error : responseError?.msg || responseError?.message || fallbackErrorMessage;
      setLoadError(errorMessage);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [intl, language, projectId, resourceId, rootPath, scope, sessionId, usesFileBrowser]);

  useEffect(() => {
    setChildrenByPath({});
    setLoadedDirectoryKeys([]);
    setExpandedKeys([]);
    setRenameTarget(null);
    void loadRoot();
  }, [loadRoot, refreshKey]);

  useEffect(() => {
    setVisibleProjectItemCount(20);
  }, [projectId, cardMode, items.length]);

  useEffect(
    () => () => {
      if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current);
    },
    []
  );

  const loadDirectory = useCallback(
    async (path: string) => {
      if (!resourceId) return;
      const normalizedPath = ensureDirectoryPath(normalizeFileBrowserPath(path));
      const response =
        scope === 'project'
          ? await queryProjectCloudDrive(resourceId, normalizedPath, language)
          : await listFiles({ resourceId, path: normalizedPath, language });
      const nextItems = sortFileBrowserItems(
        scope === 'project' ? response : unwrapListResponse<FileBrowserItem>(response)
      );
      if (normalizedPath === rootPath) {
        setItems(nextItems);
      } else {
        setChildrenByPath((current) => ({ ...current, [normalizedPath]: nextItems }));
      }
      setLoadedDirectoryKeys((current) => (current.includes(normalizedPath) ? current : [...current, normalizedPath]));
    },
    [language, resourceId, rootPath, scope]
  );

  const handleLoadData = useCallback(
    async (node: FileTreeItem) => {
      if (!isDirectory(node)) return;
      const path = ensureDirectoryPath(normalizeFileBrowserPath(node.path));
      if (childrenByPath[path]) return;
      try {
        await loadDirectory(path);
      } catch (error) {
        console.error('Failed to load conversation resource directory:', error);
        setChildrenByPath((current) => ({ ...current, [path]: [] }));
      }
    },
    [childrenByPath, loadDirectory, usesFileBrowser]
  );

  const quoteFile = useCallback(
    (item: FileBrowserItem) => {
      if (!resourceId) return;
      EventEmitter.emit('queryInput-insert-item', {
        item: normalizeReferenceItem(item, resourceId),
        type: isDirectory(item) ? DragType.commonFolder : DragType.commonFile,
      });
    },
    [EventEmitter, resourceId]
  );

  const openPreview = useCallback(
    (item: FileBrowserItem) => {
      if (!canPreviewFile(item)) {
        message.warning(intl.formatMessage({ id: 'fileBrowser.preview.unavailable' }));
        return;
      }
      if (onPreviewFile) {
        onPreviewFile(item);
        return;
      }

      const openFileInTab = (fileName: string, filePath: string) => {
        // 预览是工作区内部页签，不调用全局抽屉，因而可以与其它资源同时打开。
        onOpenDetail(
          <FilePreviewPanel
            fileName={fileName}
            resourceId={resourceId}
            path={filePath}
            fileUrl={undefined}
            sessionId={scope === 'session' ? sessionId : undefined}
            source={scope === 'project' ? 'dataset' : 'fileBrowser'}
            onOpenRelativeFile={(relativePath) => {
              const parentPath = getParentDirectoryPath(filePath);
              const resolvedPath = normalizeFileBrowserPath(`${parentPath}/${relativePath}`);
              openFileInTab(resolvedPath.split('/').pop() || relativePath, resolvedPath);
            }}
          />,
          {
            tabKey: `${scope}-file:${filePath}`,
            title: fileName,
          }
        );
      };
      openFileInTab(item.name, item.path);
    },
    [intl, onOpenDetail, onPreviewFile, resourceId, scope, sessionId]
  );

  const downloadResource = useCallback(
    async (item: FileBrowserItem) => {
      if (isProjectFile(item) && item.fileUrl) {
        downloadUrlFile({ fileUrl: item.fileUrl, fileName: item.name });
        return;
      }
      if (!resourceId) return;
      const messageKey = `chat-resource-download-${item.path}`;
      message.loading({
        key: messageKey,
        content: intl.formatMessage({ id: 'fileBrowser.download.downloading' }),
        duration: 0,
      });
      try {
        if (scope === 'project') {
          const response: any = await downloadResourceFile({
            resourceId,
            directoryPath: item.path,
          });
          const blob = response?.file instanceof Blob ? response.file : new Blob([response?.file || response]);
          downloadUrlFile({ file: blob, fileName: response?.fileName || item.name });
          message.destroy(messageKey);
          return;
        }
        const response: any = isDirectory(item)
          ? await downloadFolder(resourceId, ensureDirectoryPath(item.path))
          : await downloadFile(resourceId, item.path);
        const blob = response?.file instanceof Blob ? response.file : new Blob([response?.file || response]);
        downloadUrlFile({
          file: blob,
          fileName: response?.fileName || (isDirectory(item) ? `${item.name}.zip` : item.name),
        });
        message.destroy(messageKey);
      } catch (error: any) {
        message.destroy(messageKey);
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.download.failed' }));
      }
    },
    [intl, resourceId]
  );

  const deleteResource = useCallback(
    async (item: FileBrowserItem) => {
      try {
        // 项目云盘统一使用知识库删除接口，不能依赖 fileId 类型判断；接口返回的
        // fileId 可能是字符串，目录也可能没有 fileId。
        if (scope === 'project' && resourceId) {
          if (item.isDir) {
            await deleteFolder({ resourceId: Number(resourceId), directoryPath: ensureDirectoryPath(item.path) });
          } else {
            await removeFile({ resourceId: String(resourceId), directoryPath: item.path });
          }
          await loadRoot();
        } else if (isProjectFile(item)) {
          await deleteProjectSpaceFile({ projectId, fileId: item.fileId });
          await loadRoot();
        } else if (resourceId) {
          await deleteFiles({ resourceId, paths: [item.path] });
          const parentPath = getParentDirectoryPath(item.path);
          if (parentPath === rootPath) await loadRoot();
          else await loadDirectory(parentPath);
        }
        message.success(intl.formatMessage({ id: 'fileBrowser.delete.success' }));
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.delete.failed' }));
      }
    },
    [intl, loadDirectory, loadRoot, projectId, resourceId, rootPath]
  );

  const loadSaveDirectories = useCallback(
    async (path: string, destination: 'project' | 'shared') => {
      const rows =
        destination === 'project'
          ? await queryProjectCloudDrive(projectCloudResourceId!, path, language)
          : unwrapListResponse<FileBrowserItem>(await listFiles({ resourceId: resourceId!, path, language }));
      return rows
        .filter(isDirectory)
        .map((item) => ({ title: item.name, key: ensureDirectoryPath(item.path), isLeaf: false }));
    },
    [language, projectCloudResourceId, resourceId]
  );

  const openSaveResource = useCallback(
    async (item: FileBrowserItem, destination: 'project' | 'shared') => {
      if (!resourceId) return;
      if (destination === 'project' && !projectCloudResourceId) {
        message.error(intl.formatMessage({ id: 'chatResource.driveNotInitialized' }));
        return;
      }
      const targetRootPath = destination === 'project' ? '/' : `${DISPLAY_FILE_PATH_PREFIX}${SHARED_FILE_PATH}`;
      setSaveDestination(destination);
      setSaveTarget(item);
      setSaveTargetPath(targetRootPath);
      setSaveExpandedKeys([targetRootPath]);
      setSaveTreeData([]);
      setSaveTreeLoading(true);
      try {
        if (destination === 'shared') await ensureFolder({ resourceId, path: targetRootPath });
        const children = await loadSaveDirectories(targetRootPath, destination);
        setSaveTreeData([
          {
            title: intl.formatMessage({ id: 'chatResource.rootDirectory' }),
            key: targetRootPath,
            children,
            isLeaf: !children.length,
          },
        ]);
        // 目录数据加载完成后再展开根节点，确保 rc-tree 能正确应用展开状态。
        setSaveExpandedKeys([targetRootPath]);
      } catch (error: any) {
        setSaveTarget(null);
        message.error(error?.message || intl.formatMessage({ id: `chatResource.directoryLoadFailed.${destination}` }));
      } finally {
        setSaveTreeLoading(false);
      }
    },
    [intl, loadSaveDirectories, projectCloudResourceId, resourceId]
  );

  const copyResourceToProject = useCallback(
    async function copyResource(item: FileBrowserItem, parentPath: string): Promise<void> {
      if (!resourceId || !projectCloudResourceId) return;
      const directoryPath = ensureDirectoryPath(parentPath);
      if (isDirectory(item)) {
        try {
          await createKnowledgeFolder(
            {
              resourceId: Number(projectCloudResourceId),
              directoryPath,
              directoryName: item.name,
              directoryDescription: '',
            },
            { responseCfg: { hideErrorTips: true } }
          );
        } catch (error) {
          const siblings = await queryProjectCloudDrive(projectCloudResourceId, directoryPath, language);
          if (!siblings.some((sibling) => isDirectory(sibling) && sibling.name === item.name)) throw error;
        }
        const targetPath = ensureDirectoryPath(`${directoryPath}${item.name}`);
        const response = await listFiles({ resourceId, path: ensureDirectoryPath(item.path), language });
        for (const child of unwrapListResponse<FileBrowserItem>(response)) {
          await copyResource(child, targetPath);
        }
        return;
      }
      const response: any = await downloadFile(resourceId, item.path);
      const downloadedFile = response?.file instanceof Blob ? response.file : response;
      if (!(downloadedFile instanceof Blob)) throw new Error(intl.formatMessage({ id: 'fileBrowser.download.failed' }));
      const formData = new FormData();
      formData.append('resourceId', String(projectCloudResourceId));
      formData.append('directoryPath', directoryPath);
      formData.append('files', downloadedFile, item.name);
      const result = await uploadKnowledgeFiles(formData, { responseCfg: { hideErrorTips: true } });
      if (Number(result?.summary?.failed || 0) > 0) {
        throw new Error(result?.failedItems?.[0]?.error || intl.formatMessage({ id: 'fileBrowser.upload.failed' }));
      }
    },
    [intl, language, projectCloudResourceId, resourceId]
  );

  const copyResourceToShared = useCallback(
    async function copyResource(item: FileBrowserItem, parentPath: string): Promise<void> {
      if (!resourceId) return;
      const targetDirectory = ensureDirectoryPath(parentPath);
      if (isDirectory(item)) {
        const targetPath = ensureDirectoryPath(`${targetDirectory}${item.name}`);
        const response = await listFiles({ resourceId, path: ensureDirectoryPath(item.path), language });
        await ensureFolder({ resourceId, path: targetPath });
        for (const child of unwrapListResponse<FileBrowserItem>(response)) {
          await copyResource(child, targetPath);
        }
        return;
      }
      await copyFile({ resourceId, sourcePath: item.path, targetDirectory });
    },
    [language, resourceId]
  );

  const confirmSaveResource = useCallback(async () => {
    if (!saveTarget || !resourceId || savingResource || saveTreeLoading) return;
    setSavingResource(true);
    try {
      if (saveDestination === 'shared') {
        await copyResourceToShared(saveTarget, saveTargetPath);
      } else {
        if (!projectCloudResourceId) throw new Error(intl.formatMessage({ id: 'chatResource.driveNotInitialized' }));
        await copyResourceToProject(saveTarget, saveTargetPath);
      }
      message.success(intl.formatMessage({ id: 'fileBrowser.save.success' }, { target: saveDestinationLabel }));
      setSaveTarget(null);
    } catch (error: any) {
      const errorMessage =
        error?.response?.data?.msg || error?.data?.msg || error?.msg || error?.message || `${error || ''}`;
      message.error(
        intl.formatMessage(
          { id: errorMessage ? 'chatResource.saveFailedWithReason' : 'fileBrowser.save.failed' },
          { target: saveDestinationLabel, reason: errorMessage }
        )
      );
    } finally {
      setSavingResource(false);
    }
  }, [
    copyResourceToProject,
    copyResourceToShared,
    intl,
    projectCloudResourceId,
    resourceId,
    saveDestination,
    saveDestinationLabel,
    saveTarget,
    saveTargetPath,
    saveTreeLoading,
    savingResource,
  ]);

  const moveResource = useCallback(async () => {
    if (!moveTarget || !resourceId) return;
    setMoving(true);
    try {
      if (scope === 'project') {
        await moveKnowledgeItems({
          resourceId: Number(resourceId),
          sourcePath: [moveTarget.path],
          targetDirectoryPath: ensureDirectoryPath(moveTargetDirectory || '/'),
        });
      } else {
        await moveFiles({
          resourceId,
          sourcePaths: [moveTarget.path],
          targetDirectory: ensureDirectoryPath(moveTargetDirectory || '/'),
        });
      }
      setMoveTarget(null);
      await loadRoot();
      message.success(intl.formatMessage({ id: 'fileBrowser.move.success' }));
    } catch (error: any) {
      message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.move.failed' }));
    } finally {
      setMoving(false);
    }
  }, [intl, loadRoot, message, moveTarget, moveTargetDirectory, resourceId, scope, usesFileBrowser]);

  const loadMoveDirectories = useCallback(
    async (path: string) => {
      const rows =
        scope === 'project'
          ? await queryProjectCloudDrive(Number(resourceId), path, language)
          : await listFiles({ resourceId: resourceId!, path, language });
      return (rows || [])
        .filter((item: any) => item?.isDir || item?.type === 'directory')
        .map((item: any) => ({
          title: item.name,
          key: ensureDirectoryPath(item.path || item.directoryPath || `${path}${item.name}`),
          isLeaf: false,
        }));
    },
    [language, resourceId, scope, usesFileBrowser]
  );

  useEffect(() => {
    if (!moveTarget || !resourceId) return;
    setMoveTreeLoading(true);
    loadMoveDirectories('/')
      .then((children) =>
        setMoveTreeData([{ title: intl.formatMessage({ id: 'chatResource.rootDirectory' }), key: '/', children }])
      )
      .catch(() =>
        setMoveTreeData([{ title: intl.formatMessage({ id: 'chatResource.rootDirectory' }), key: '/', children: [] }])
      )
      .finally(() => setMoveTreeLoading(false));
  }, [intl, loadMoveDirectories, moveTarget, resourceId]);

  const getActionItems = useCallback(
    (item: FileBrowserItem): MenuProps['items'] => {
      const keys = [
        ...(resourceId ? ['quote'] : []),
        ...(canPreviewFile(item) ? ['preview'] : []),
        'download',
        ...(resourceId && isDirectory(item) ? ['upload', 'createSibling', 'createChild'] : []),
        ...(scope === 'project' && resourceId ? ['move'] : []),
        ...(usesFileBrowser || canManageProjectFiles ? ['rename'] : []),
        // 项目云盘的重命名和删除由知识库接口执行，菜单始终展示，最终权限由后端校验。
        ...(scope === 'project' && resourceId && !canManageProjectFiles ? ['rename', 'delete'] : []),
        ...(scope === 'session' && projectId && projectId !== -1 ? ['saveToProject'] : []),
        ...(scope === 'session' && resourceId ? ['saveToShared'] : []),
        ...(usesFileBrowser || canManageProjectFiles ? ['delete'] : []),
      ];
      const labels: Record<string, string> = {
        quote: intl.formatMessage({ id: 'common.quote' }),
        preview: intl.formatMessage({ id: 'fileBrowser.action.preview' }),
        download: intl.formatMessage({ id: 'directoryManage.downloadFile' }),
        upload: intl.formatMessage({ id: 'chatResource.uploadFile' }),
        createSibling: intl.formatMessage({ id: 'chatResource.createSiblingFolder' }),
        createChild: intl.formatMessage({ id: 'chatResource.createChildFolder' }),
        move: intl.formatMessage({ id: 'chatResource.move' }),
        rename: intl.formatMessage({ id: 'fileBrowser.action.rename' }),
        delete: intl.formatMessage({ id: 'fileBrowser.action.delete' }),
        saveToProject: intl.formatMessage({ id: 'chatResource.saveToProject' }),
        saveToShared: intl.formatMessage({ id: 'chatResource.saveToShared' }),
      };
      return keys.map((key) => ({
        key,
        danger: key === 'delete',
        disabled: key === 'delete' && !canDeleteProjectItem(item),
        label:
          key === 'delete' && !canDeleteProjectItem(item) ? (
            <Tooltip title={intl.formatMessage({ id: 'chatResource.deleteNotAllowed' })}>
              <div className={employeeStyles.dropdownMenuItem}>{labels[key]}</div>
            </Tooltip>
          ) : (
            <div className={employeeStyles.dropdownMenuItem}>{labels[key]}</div>
          ),
      }));
    },
    [canDeleteProjectItem, canManageProjectFiles, intl, projectId, resourceId, scope, usesFileBrowser]
  );

  const handleUpload = useCallback(
    async (fileList: File[], targetPath = rootPath) => {
      if (!resourceId || !fileList.length || uploading) return;
      setUploading(true);
      try {
        if (scope === 'project') {
          const formData = new FormData();
          fileList.forEach((file) => formData.append('files', file));
          formData.append('resourceId', String(resourceId));
          formData.append('directoryPath', targetPath);
          await uploadKnowledgeFiles(formData, { responseCfg: { hideErrorTips: true } });
        } else {
          await uploadFiles(resourceId, targetPath, fileList);
        }
        message.success(intl.formatMessage({ id: 'fileBrowser.upload.success' }));
        await loadRoot();
      } catch (error: any) {
        const errorMessage =
          (typeof error === 'string' ? error : undefined) ||
          error?.response?.data?.msg ||
          error?.data?.msg ||
          error?.msg ||
          error?.message;
        message.error(errorMessage || intl.formatMessage({ id: 'fileBrowser.upload.failed' }));
      } finally {
        setUploading(false);
      }
    },
    [intl, loadRoot, resourceId, rootPath, uploading]
  );

  const handleCreateFolder = useCallback(async () => {
    const name = createFolderName.trim();
    if (!resourceId || !name) return;
    setCreatingFolder(true);
    try {
      if (scope === 'project') {
        await createKnowledgeFolder(
          {
            resourceId: Number(resourceId),
            directoryPath: ensureDirectoryPath(createFolderPath),
            directoryName: name,
            directoryDescription: '',
          },
          { responseCfg: { hideErrorTips: true } }
        );
      } else {
        await createFolder({ resourceId, path: `${ensureDirectoryPath(createFolderPath)}${name}/` });
      }
      message.success(intl.formatMessage({ id: 'fileBrowser.createFolder.success' }));
      setCreateFolderOpen(false);
      setCreateFolderName('');
      await loadRoot();
    } catch (error: any) {
      const errorMessage = typeof error === 'string' ? error : error?.message || error?.msg;
      message.error(errorMessage || intl.formatMessage({ id: 'fileBrowser.createFolder.failed' }));
    } finally {
      setCreatingFolder(false);
    }
  }, [createFolderName, createFolderPath, intl, loadRoot, resourceId]);

  const handleAction = useCallback(
    (key: Key, item: FileBrowserItem) => {
      if (key === 'quote') quoteFile(item);
      if (key === 'preview') openPreview(item);
      if (key === 'download') void downloadResource(item);
      if (key === 'move') {
        setMoveTargetDirectory(rootPath);
        setMoveTarget(item);
      }
      if (key === 'upload') {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.onchange = () => {
          const files = Array.from(input.files || []);
          if (files.length) void handleUpload(files, ensureDirectoryPath(item.path));
        };
        input.click();
      }
      if (key === 'createSibling' || key === 'createChild') {
        setCreateFolderPath(key === 'createChild' ? ensureDirectoryPath(item.path) : getParentDirectoryPath(item.path));
        setCreateFolderName('');
        setCreateFolderOpen(true);
      }
      if (key === 'rename') setRenameTarget(item);
      if (key === 'saveToProject') void openSaveResource(item, 'project');
      if (key === 'saveToShared') void openSaveResource(item, 'shared');
      if (key === 'delete') {
        if (!canDeleteProjectItem(item)) {
          message.info(intl.formatMessage({ id: 'chatResource.deleteNotAllowed' }));
          return;
        }
        Modal.confirm({
          title: intl.formatMessage({ id: 'fileBrowser.delete.confirm' }),
          content: intl.formatMessage({ id: 'fileBrowser.delete.confirmName' }, { name: item.name }),
          okButtonProps: { danger: true },
          onOk: () => deleteResource(item),
        });
      }
    },
    [
      canDeleteProjectItem,
      deleteResource,
      downloadResource,
      handleUpload,
      intl,
      openPreview,
      quoteFile,
      rootPath,
      openSaveResource,
    ]
  );

  const handleRename = useCallback(
    async (newName: string) => {
      if (!renameTarget) return;
      setRenameLoading(true);
      try {
        // 项目云盘与知识库目录管理保持一致：文件夹调用 renameFolder，文件调用 updateFileInfo。
        if (scope === 'project' && resourceId) {
          if (renameTarget.isDir) {
            await renameFolder({
              resourceId: Number(resourceId),
              directoryName: newName,
              directoryPath: ensureDirectoryPath(renameTarget.path),
            });
          } else {
            await updateFileInfo({ fileId: (renameTarget as any).fileId, fileName: newName });
          }
          await loadDirectory(getParentDirectoryPath(renameTarget.path));
        } else if (isProjectFile(renameTarget)) {
          await renameProjectSpaceFile({ projectId, fileId: renameTarget.fileId, fileName: newName });
          await loadRoot();
        } else if (resourceId) {
          const parentPath = getParentDirectoryPath(renameTarget.path);
          await renameFile({ resourceId, sourcePath: renameTarget.path, newName });
          if (parentPath === rootPath) await loadRoot();
          else await loadDirectory(parentPath);
        }
        message.success(intl.formatMessage({ id: 'fileBrowser.rename.success' }));
        setRenameTarget(null);
      } catch (error: any) {
        const errorMessage =
          (typeof error === 'string' ? error : undefined) ||
          error?.response?.data?.error_description ||
          error?.response?.data?.msg ||
          error?.data?.error_description ||
          error?.data?.msg ||
          error?.error_description ||
          error?.msg ||
          error?.message;
        message.error(errorMessage || intl.formatMessage({ id: 'fileBrowser.rename.failed' }));
      } finally {
        setRenameLoading(false);
      }
    },
    [intl, loadDirectory, loadRoot, projectId, renameTarget, resourceId, rootPath]
  );

  const handleNodeClick = useCallback(
    (event: React.MouseEvent, item: FileTreeItem) => {
      event.stopPropagation();
      if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = window.setTimeout(() => {
        clickTimerRef.current = null;
        if (!isDirectory(item)) openPreview(item);
      }, 220);
    },
    [openPreview]
  );

  const handleNodeDoubleClick = useCallback(
    (item: FileTreeItem) => {
      if (clickTimerRef.current !== null) {
        window.clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      quoteFile(item);
    },
    [quoteFile]
  );

  const emptyTextId = {
    project: 'projectSpace.detail.resource.emptySharedFiles',
    shared: 'projectSpace.detail.resource.emptySharedFiles',
    session: 'projectSpace.detail.resource.emptySessionFiles',
  }[scope];
  const visibleProjectItems = items.slice(0, visibleProjectItemCount);
  const hasMoreProjectItems = cardMode && scope === 'project' && visibleProjectItemCount < items.length;
  const projectCardSentinelRef = useInfiniteScroll(
    () => setVisibleProjectItemCount((current) => Math.min(current + 20, items.length)),
    hasMoreProjectItems && !loading
  );

  if (cardMode && scope === 'project') {
    const formatFileSize = (size?: number) => {
      if (!size) return '0 B';
      if (size < 1024) return `${size} B`;
      if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
      return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    };
    const formatUpdatedAt = (value?: string) => {
      if (!value) return '-';
      const date = new Date(value);
      const options: Intl.DateTimeFormatOptions = {
        hour12: false,
        ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }),
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      };
      return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', options);
    };
    return (
      <>
        <div className={projectStyles.resourceCardGrid}>
          {visibleProjectItems.length ? (
            visibleProjectItems.map((item) => (
              <article
                key={item.path}
                className={projectStyles.resourceCard}
                onClick={() => {
                  if (!isDirectory(item)) openPreview(item);
                }}
                onDoubleClick={() => handleNodeDoubleClick(item as FileTreeItem)}
              >
                <div className={projectStyles.dataCardHeader}>
                  <FilePathTooltip item={item}>
                    <Typography.Text strong ellipsis>
                      {item.name}
                    </Typography.Text>
                  </FilePathTooltip>
                  <Dropdown
                    trigger={['hover']}
                    menu={{
                      items: getActionItems(item),
                      onClick: ({ key }) => handleAction(key, item),
                    }}
                  >
                    <button
                      type="button"
                      className={projectStyles.resourceCardAction}
                      aria-label={intl.formatMessage({ id: 'common.more' })}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <EllipsisOutlined />
                    </button>
                  </Dropdown>
                </div>
                <Typography.Text type="secondary" className={projectStyles.resourceCardMeta}>
                  {!item.isDir && (
                    <>
                      {formatFileSize((item as ProjectFileItem).size)}
                      <span>·</span>
                    </>
                  )}
                  <span>{formatUpdatedAt((item as ProjectFileItem).updatedAt)}</span>
                  <span className={projectStyles.resourceCardMetaPerson}>
                    {(item as ProjectFileItem).createStaffName || '-'}
                  </span>
                </Typography.Text>
              </article>
            ))
          ) : (
            <div className={projectStyles.resourceCardEmpty}>
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  loadError ||
                  (!resourceId
                    ? intl.formatMessage({ id: 'chatResource.knowledgeNotInitialized' })
                    : intl.formatMessage({ id: emptyTextId }))
                }
              />
            </div>
          )}
          <div ref={projectCardSentinelRef} className={projectStyles.loadMoreSentinel} />
        </div>
        <RenameModal
          open={!!renameTarget}
          currentName={renameTarget?.name || ''}
          loading={renameLoading}
          onOk={handleRename}
          onCancel={() => {
            if (!renameLoading) setRenameTarget(null);
          }}
        />
        <Modal
          open={!!moveTarget}
          title={intl.formatMessage({ id: 'fileBrowser.move.title' })}
          confirmLoading={moving}
          onOk={() => void moveResource()}
          onCancel={() => {
            if (!moving) setMoveTarget(null);
          }}
          destroyOnClose
        >
          <Spin spinning={moveTreeLoading}>
            <Tree
              treeData={moveTreeData}
              defaultExpandedKeys={['/']}
              selectedKeys={[moveTargetDirectory]}
              onSelect={(keys) => {
                if (keys.length) setMoveTargetDirectory(String(keys[0]));
              }}
              loadData={async (node: any) => {
                if (node.children?.length) return;
                const children = await loadMoveDirectories(String(node.key));
                node.children = children;
                setMoveTreeData((current) => [...current]);
              }}
              blockNode
              showIcon
            />
          </Spin>
        </Modal>
      </>
    );
  }

  return (
    <>
      <FileSpaceBlock
        title={null}
        hideHeader
        fillContainer
        loading={loading}
        items={items}
        currentPath={rootPath}
        resourceEmptyStyle
        compactResourceEmpty={compactResourceEmpty}
        showItemMeta
        emptyText={
          loadError ||
          (scope === 'project' && !resourceId
            ? intl.formatMessage({ id: 'chatResource.knowledgeNotInitialized' })
            : intl.formatMessage({ id: emptyTextId }))
        }
        contentBefore={
          scope !== 'session' && resourceId && !hideProjectToolbar ? (
            <div className={styles.localSharedToolbar}>
              <Upload
                showUploadList={false}
                multiple
                disabled={uploading}
                beforeUpload={(file, fileList) => {
                  if (file === fileList[0]) void handleUpload(fileList as unknown as File[], rootPath);
                  return false;
                }}
              >
                <Tooltip title={intl.formatMessage({ id: 'fileBrowser.toolbar.upload' })}>
                  <Button
                    size="small"
                    aria-label={intl.formatMessage({ id: 'fileBrowser.toolbar.upload' })}
                    icon={<UploadOutlined />}
                    loading={uploading}
                  />
                </Tooltip>
              </Upload>
              <Tooltip title={intl.formatMessage({ id: 'fileBrowser.toolbar.newFolder' })}>
                <Button
                  size="small"
                  aria-label={intl.formatMessage({ id: 'fileBrowser.toolbar.newFolder' })}
                  icon={<FolderAddOutlined />}
                  onClick={() => {
                    setCreateFolderPath(rootPath);
                    setCreateFolderName('');
                    setCreateFolderOpen(true);
                  }}
                />
              </Tooltip>
            </div>
          ) : null
        }
        childrenByPath={childrenByPath}
        expandedKeys={expandedKeys}
        loadedKeys={loadedDirectoryKeys}
        showActions
        onRefresh={loadRoot}
        onExpand={setExpandedKeys}
        onLoadData={handleLoadData}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        getActionItems={getActionItems}
        onAction={handleAction}
      />
      <RenameModal
        open={!!renameTarget}
        currentName={renameTarget?.name || ''}
        loading={renameLoading}
        onOk={handleRename}
        onCancel={() => {
          if (!renameLoading) setRenameTarget(null);
        }}
      />
      <Modal
        open={!!saveTarget}
        title={intl.formatMessage({ id: 'chatResource.saveTo' }, { target: saveDestinationLabel })}
        okText={intl.formatMessage({ id: 'common.save' })}
        cancelText={intl.formatMessage({ id: 'common.cancel' })}
        confirmLoading={savingResource}
        okButtonProps={{ disabled: saveTreeLoading }}
        onOk={() => void confirmSaveResource()}
        onCancel={() => {
          if (!savingResource && !saveTreeLoading) setSaveTarget(null);
        }}
        destroyOnClose
        className={styles.saveProjectModal}
      >
        <div className={styles.saveProjectTreeScroll}>
          <Spin spinning={saveTreeLoading}>
            <Tree
              disabled={savingResource}
              treeData={saveTreeData}
              expandedKeys={saveExpandedKeys}
              selectedKeys={[saveTargetPath]}
              onExpand={(keys) => setSaveExpandedKeys(keys)}
              onSelect={(keys) => {
                if (keys.length) setSaveTargetPath(String(keys[0]));
              }}
              loadData={async (node: any) => {
                if (node.children?.length) return;
                setSaveTreeLoading(true);
                try {
                  const children = await loadSaveDirectories(String(node.key), saveDestination);
                  const updateChildren = (nodes: any[]): any[] =>
                    nodes.map((item) => {
                      if (String(item.key) === String(node.key)) {
                        return { ...item, children, isLeaf: children.length === 0 };
                      }
                      if (Array.isArray(item.children) && item.children.length > 0) {
                        return { ...item, children: updateChildren(item.children) };
                      }
                      return item;
                    });
                  setSaveTreeData((current) => updateChildren(current));
                } finally {
                  setSaveTreeLoading(false);
                }
              }}
              blockNode
              showIcon
            />
          </Spin>
        </div>
      </Modal>
      <Modal
        open={!!moveTarget}
        title={intl.formatMessage({ id: 'fileBrowser.move.title' })}
        confirmLoading={moving}
        onOk={() => void moveResource()}
        onCancel={() => {
          if (!moving) setMoveTarget(null);
        }}
        destroyOnClose
      >
        <Spin spinning={moveTreeLoading}>
          <Tree
            treeData={moveTreeData}
            defaultExpandedKeys={['/']}
            selectedKeys={[moveTargetDirectory]}
            onSelect={(keys) => {
              if (keys.length) setMoveTargetDirectory(String(keys[0]));
            }}
            loadData={async (node: any) => {
              if (node.children?.length) return;
              const children = await loadMoveDirectories(String(node.key));
              node.children = children;
              setMoveTreeData((current) => [...current]);
            }}
            blockNode
            showIcon
          />
        </Spin>
      </Modal>
      <CreateFolderModal
        open={createFolderOpen}
        value={createFolderName}
        loading={creatingFolder}
        onChange={setCreateFolderName}
        onOk={() => void handleCreateFolder()}
        onCancel={() => {
          if (creatingFolder) return;
          setCreateFolderOpen(false);
          setCreateFolderName('');
          setCreateFolderPath(rootPath);
        }}
      />
    </>
  );
};

export default FileResourcePanel;
