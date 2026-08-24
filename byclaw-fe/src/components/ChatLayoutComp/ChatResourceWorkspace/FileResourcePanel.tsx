import React, { useCallback, useEffect, useMemo, useRef, useState, type Key } from 'react';
import { Dropdown, Empty, Modal, Typography, message, type MenuProps } from 'antd';
import { EllipsisOutlined } from '@ant-design/icons';
import { useIntl, useSelector } from '@umijs/max';
import FileSpaceBlock from '@/layout/sider/components/FileSiderPanel/components/FileSpaceBlock';
import type { FileTreeItem } from '@/layout/sider/components/FileSiderPanel/constants';
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
  listProjectSpaceFiles,
  listProjectRepos,
  type DevloopProjectRepo,
  renameProjectSpaceFile,
  saveProjectFileToSpace,
  type DevloopProjectSpaceFile,
} from '@/service/devloop';
import {
  deleteFiles,
  downloadFile,
  downloadFolder,
  listFiles,
  renameFile,
  type FileBrowserItem,
} from '@/service/fileBrowser';
import { downloadFile as downloadUrlFile } from '@/utils/file';
import type { DetailPanelOptions } from '@/layout/sider/siderContentContext';
import FilePreviewPanel from './FilePreviewPanel';
import projectStyles from '@/pages/projectSpace/index.module.less';
import { useInfiniteScroll } from '@/pages/projectSpace/hooks/useInfiniteScroll';
import { filterSessionRootItems } from './sessionResourceUtils';

type ProjectFileItem = FileBrowserItem & {
  fileId: number;
  fileUrl: string;
};

interface FileResourcePanelProps {
  scope: 'session' | 'project';
  sessionId: string;
  projectId?: number;
  project?: ProjectSpace;
  resourceId?: string;
  refreshKey?: number;
  onOpenDetail: (panel: React.ReactNode, options: DetailPanelOptions) => void;
  // 项目大详情使用卡片视图；会话资源继续复用原文件树交互。
  cardMode?: boolean;
}

const normalizeProjectFile = (file: DevloopProjectSpaceFile): ProjectFileItem => ({
  name: file.fileName,
  path: file.fileUrl || `/.project/${file.fileId}/${file.fileName}`,
  isDir: false,
  fileId: file.fileId,
  fileUrl: file.fileUrl,
});

// 项目共享文件接口没有 FileBrowserItem 的目录字段，转换后即可复用左侧文件树及操作菜单。
const isProjectFile = (item: FileBrowserItem): item is ProjectFileItem => Number.isFinite((item as any).fileId);

const FileResourcePanel: React.FC<FileResourcePanelProps> = ({
  scope,
  sessionId,
  projectId: projectIdProp,
  project,
  resourceId,
  refreshKey = 0,
  onOpenDetail,
  cardMode = false,
}) => {
  const intl = useIntl();
  const { EventEmitter } = useGlobal();
  const userInfo = useSelector((state: any) => state.user.userInfo);
  const [items, setItems] = useState<FileBrowserItem[]>([]);
  const [childrenByPath, setChildrenByPath] = useState<Record<string, FileBrowserItem[]>>({});
  const [expandedKeys, setExpandedKeys] = useState<Key[]>([]);
  const [loading, setLoading] = useState(false);
  const [renameTarget, setRenameTarget] = useState<FileBrowserItem | null>(null);
  const [renameLoading, setRenameLoading] = useState(false);
  const [visibleProjectItemCount, setVisibleProjectItemCount] = useState(20);
  const clickTimerRef = useRef<number | null>(null);
  const rootPath = getSessionFilePath(sessionId);
  // 项目详情异步加载期间也使用外部项目 ID，确保首次会话文件请求即可过滤仓库目录。
  const projectId = projectIdProp ?? Number(project?.projectId);
  const canManageProjectFiles = useMemo(() => {
    const currentUserId = userInfo?.userId ?? userInfo?.id;
    return (
      currentUserId !== undefined &&
      project?.createBy !== undefined &&
      project.createBy !== null &&
      `${currentUserId}` === `${project.createBy}`
    );
  }, [project?.createBy, userInfo?.id, userInfo?.userId]);

  const loadRoot = useCallback(async () => {
    if (scope === 'session' && (!resourceId || !sessionId)) {
      setItems([]);
      return;
    }
    if (scope === 'project' && !projectId) {
      setItems([]);
      return;
    }

    setLoading(true);
    try {
      if (scope === 'project') {
        const response = await listProjectSpaceFiles(projectId);
        setItems(sortFileBrowserItems(unwrapListResponse<DevloopProjectSpaceFile>(response).map(normalizeProjectFile)));
      } else {
        // eslint-disable-next-line lines-around-comment
        // 文件与仓库并行查询，但等两者都结束后再更新列表，避免仓库目录先闪现后消失。
        const [filesResult, reposResult] = await Promise.allSettled([
          listFiles({ resourceId: resourceId!, path: rootPath }),
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
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [projectId, resourceId, rootPath, scope, sessionId]);

  useEffect(() => {
    setChildrenByPath({});
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
      const response = await listFiles({ resourceId, path: normalizedPath });
      const nextItems = sortFileBrowserItems(unwrapListResponse<FileBrowserItem>(response));
      if (normalizedPath === rootPath) {
        setItems(nextItems);
      } else {
        setChildrenByPath((current) => ({ ...current, [normalizedPath]: nextItems }));
      }
    },
    [resourceId, rootPath]
  );

  const handleLoadData = useCallback(
    async (node: FileTreeItem) => {
      if (scope !== 'session' || !isDirectory(node)) return;
      const path = ensureDirectoryPath(normalizeFileBrowserPath(node.path));
      if (childrenByPath[path]) return;
      try {
        await loadDirectory(path);
      } catch (error) {
        console.error('Failed to load conversation resource directory:', error);
        setChildrenByPath((current) => ({ ...current, [path]: [] }));
      }
    },
    [childrenByPath, loadDirectory, scope]
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
      const projectFile = isProjectFile(item) ? item : undefined;
      const projectFileUrl = projectFile?.fileUrl || undefined;

      // 预览是工作区内部页签，不调用全局抽屉，因而可以与其它资源同时打开。
      onOpenDetail(
        <FilePreviewPanel
          fileName={item.name}
          resourceId={projectFileUrl ? undefined : resourceId}
          path={projectFileUrl ? undefined : item.path}
          fileUrl={projectFileUrl}
          sessionId={scope === 'session' ? sessionId : undefined}
          source="fileBrowser"
        />,
        {
          tabKey: `${scope}-file:${projectFile?.fileId || item.path}`,
          title: item.name,
        }
      );
    },
    [intl, onOpenDetail, resourceId, scope, sessionId]
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
        if (isProjectFile(item)) {
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

  const saveToProject = useCallback(
    async (item: FileBrowserItem) => {
      if (!projectId) return;
      const messageKey = `chat-resource-save-${item.path}`;
      message.loading({
        key: messageKey,
        content: intl.formatMessage({ id: 'projectSpace.detail.resource.savingToSpace' }),
        duration: 0,
      });
      try {
        await saveProjectFileToSpace({
          projectId,
          sessionId: Number(sessionId),
          filePath: item.path,
          fileName: item.name,
        });
        message.success({
          key: messageKey,
          content: intl.formatMessage({ id: 'projectSpace.detail.resource.savedToSpace' }),
        });
      } catch (error: any) {
        message.error({
          key: messageKey,
          content: error?.message || intl.formatMessage({ id: 'projectSpace.detail.resource.saveToSpaceFailed' }),
        });
      }
    },
    [intl, projectId, sessionId]
  );

  const getActionItems = useCallback(
    (item: FileBrowserItem): MenuProps['items'] => {
      const keys = [
        ...(resourceId ? ['quote'] : []),
        ...(canPreviewFile(item) ? ['preview'] : []),
        'download',
        ...(scope === 'session' || canManageProjectFiles ? ['rename', 'delete'] : []),
        ...(scope === 'session' && !isDirectory(item) && projectId ? ['saveToProject'] : []),
      ];
      const labels: Record<string, string> = {
        quote: intl.formatMessage({ id: 'common.quote' }),
        preview: intl.formatMessage({ id: 'fileBrowser.action.preview' }),
        download: intl.formatMessage({ id: 'directoryManage.downloadFile' }),
        rename: intl.formatMessage({ id: 'fileBrowser.action.rename' }),
        delete: intl.formatMessage({ id: 'fileBrowser.action.delete' }),
        saveToProject: intl.formatMessage({ id: 'projectSpace.detail.resource.saveToSpace' }),
      };
      return keys.map((key) => ({
        key,
        danger: key === 'delete',
        label: <div className={employeeStyles.dropdownMenuItem}>{labels[key]}</div>,
      }));
    },
    [canManageProjectFiles, intl, projectId, resourceId, scope]
  );

  const handleAction = useCallback(
    (key: Key, item: FileBrowserItem) => {
      if (key === 'quote') quoteFile(item);
      if (key === 'preview') openPreview(item);
      if (key === 'download') void downloadResource(item);
      if (key === 'rename') setRenameTarget(item);
      if (key === 'saveToProject') void saveToProject(item);
      if (key === 'delete') {
        Modal.confirm({
          title: intl.formatMessage({ id: 'fileBrowser.delete.confirm' }),
          content: intl.formatMessage({ id: 'fileBrowser.delete.confirmName' }, { name: item.name }),
          okButtonProps: { danger: true },
          onOk: () => deleteResource(item),
        });
      }
    },
    [deleteResource, downloadResource, intl, openPreview, quoteFile, saveToProject]
  );

  const handleRename = useCallback(
    async (newName: string) => {
      if (!renameTarget) return;
      setRenameLoading(true);
      try {
        if (isProjectFile(renameTarget)) {
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
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.rename.failed' }));
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

  const emptyTextId =
    scope === 'project'
      ? 'projectSpace.detail.resource.emptySharedFiles'
      : 'projectSpace.detail.resource.emptySessionFiles';
  const visibleProjectItems = items.slice(0, visibleProjectItemCount);
  const hasMoreProjectItems = cardMode && scope === 'project' && visibleProjectItemCount < items.length;
  const projectCardSentinelRef = useInfiniteScroll(
    () => setVisibleProjectItemCount((current) => Math.min(current + 20, items.length)),
    hasMoreProjectItems && !loading
  );

  if (cardMode && scope === 'project') {
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
                  <Typography.Text strong ellipsis={{ tooltip: item.name }}>
                    {item.name}
                  </Typography.Text>
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
                      aria-label="更多操作"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <EllipsisOutlined />
                    </button>
                  </Dropdown>
                </div>
                <Typography.Text type="secondary">{item.isDir ? '文件夹' : '文件'}</Typography.Text>
              </article>
            ))
          ) : (
            <div className={projectStyles.resourceCardEmpty}>
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={intl.formatMessage({ id: emptyTextId })} />
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
        currentPath={scope === 'session' ? rootPath : '/.project/'}
        emptyText={intl.formatMessage({ id: emptyTextId })}
        childrenByPath={childrenByPath}
        expandedKeys={expandedKeys}
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
    </>
  );
};

export default FileResourcePanel;
