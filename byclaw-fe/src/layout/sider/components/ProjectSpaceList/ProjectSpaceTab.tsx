import React, { useCallback, useEffect, useRef, useState, type Key } from 'react';
import { Button, Drawer, Input, Modal, Spin, Tooltip, Tree, Upload, message, type MenuProps } from 'antd';
import { FolderAddOutlined, GithubOutlined, UploadOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import FilePreviewPanel from '@/components/ChatLayoutComp/ChatResourceWorkspace/FilePreviewPanel';
import { DragType } from '@/components/QueryInput/withDrag';
import useGlobal from '@/hooks/useGlobal';
import FileSpaceBlock from '@/layout/sider/components/FileSiderPanel/components/FileSpaceBlock';
import CodesTab from './CodesTab';
import type { FileTreeItem } from '@/layout/sider/components/FileSiderPanel/constants';
import {
  canPreviewFile,
  ensureDirectoryPath,
  isDirectory,
  normalizeReferenceItem,
  sortFileBrowserItems,
  unwrapListResponse,
} from '@/layout/sider/components/FileSiderPanel/utils';
import type { DetailPanelOptions } from '@/layout/sider/siderContentContext';
import {
  createProjectSpaceFolder,
  listProjectSpaceTree,
  uploadProjectSpaceFiles,
  type ProjectSpaceTreeNode,
} from '@/service/devloop';
import { deleteFiles, downloadFile, downloadFolder, renameFile, type FileBrowserItem } from '@/service/fileBrowser';
import { uploadFiles as uploadKnowledgeFiles } from '@/service/knowledgeCenter';
import { queryProjectCloudDrive } from '@/components/ProjectCloudDrive';
import styles from './index.module.less';

interface LocalGitRepositoryViewProps {
  projectId: number;
  repositoryPath: string;
  resourceId?: string | number;
  onOpenDetail?: (panel: React.ReactNode, options: DetailPanelOptions) => void;
  getActionItems?: (item: FileBrowserItem) => MenuProps['items'];
  onAction?: (key: Key, item: FileBrowserItem) => void;
  repository?: SpaceItem;
}

const toLocalGitItems = (nodes: ProjectSpaceTreeNode[], rootPath: string, repositoryPath: string) => {
  const prefix = `${repositoryPath.replace(/^\/+|\/+$/g, '')}/`;
  return nodes.map((node) => {
    const nodePath = node.path.replace(/^\/+/, '');
    const relativePath = nodePath.startsWith(prefix) ? nodePath.slice(prefix.length) : nodePath;
    const path = `${rootPath}${relativePath}`;
    return {
      name: node.name,
      path: node.type === 'directory' ? ensureDirectoryPath(path) : path,
      isDir: node.type === 'directory',
      size: node.size,
      lastModified: node.lastModified,
    } as FileBrowserItem;
  });
};

/**
 * A Git directory can exist in the project workspace before it is registered
 * as a project repository. In that case there is no repoId for CodesTab to
 * query, but the files are still available through the project-space API.
 */
const LocalGitRepositoryView: React.FC<LocalGitRepositoryViewProps> = ({
  projectId,
  repositoryPath,
  resourceId,
  onOpenDetail,
  getActionItems,
  onAction,
  repository,
}) => {
  const { EventEmitter } = useGlobal();
  const [items, setItems] = useState<FileBrowserItem[]>([]);
  const [childrenByPath, setChildrenByPath] = useState<Record<string, FileBrowserItem[]>>({});
  const [expandedKeys, setExpandedKeys] = useState<Key[]>([]);
  const [loading, setLoading] = useState(false);
  const rootPath = `/by/projects/${projectId}/${repositoryPath.replace(/^\/+|\/+$/g, '')}/`;
  const relativeRoot = repositoryPath.replace(/^\/+|\/+$/g, '');

  const load = useCallback(
    async (relativePath?: string) => {
      setLoading(true);
      try {
        const response = await listProjectSpaceTree({ projectId, path: relativePath || relativeRoot });
        const currentRootPath = relativePath
          ? ensureDirectoryPath(`${rootPath}${relativePath.slice(relativeRoot.length)}`)
          : rootPath;
        const next = sortFileBrowserItems(
          toLocalGitItems(
            unwrapListResponse<ProjectSpaceTreeNode>(response),
            currentRootPath,
            relativePath || relativeRoot
          )
        );
        const key = relativePath ? currentRootPath : rootPath;
        if (relativePath) setChildrenByPath((current) => ({ ...current, [key]: next }));
        else setItems(next);
      } catch (error) {
        console.error('Failed to load unregistered Git repository files:', error);
        if (!relativePath) setItems([]);
      } finally {
        setLoading(false);
      }
    },
    [projectId, relativeRoot, rootPath]
  );

  useEffect(() => {
    setItems([]);
    setChildrenByPath({});
    setExpandedKeys([]);
    void load();
  }, [load]);

  const loadNode = useCallback(
    async (node: FileTreeItem) => {
      if (!isDirectory(node)) return;
      const path = ensureDirectoryPath(node.path);
      if (childrenByPath[path]) return;
      const relative = path.slice(rootPath.length).replace(/\/$/, '');
      await load(`${relativeRoot}/${relative}`);
    },
    [childrenByPath, load, relativeRoot, rootPath]
  );

  const openPreview = useCallback(
    (item: FileTreeItem) => {
      if (!onOpenDetail || !resourceId || !canPreviewFile(item)) return;
      onOpenDetail(
        <FilePreviewPanel fileName={item.name} resourceId={`${resourceId}`} path={item.path} source="fileBrowser" />,
        { tabKey: `project-space-file:${item.path}`, title: item.name }
      );
    },
    [onOpenDetail, resourceId]
  );

  const onNodeClick = useCallback(
    (event: React.MouseEvent, node: FileTreeItem) => {
      event.stopPropagation();
      if (!isDirectory(node)) openPreview(node);
    },
    [openPreview]
  );

  const quote = useCallback(
    (item: FileTreeItem) => {
      if (!resourceId) return;
      EventEmitter.emit('queryInput-insert-item', {
        item: normalizeReferenceItem(item, `${resourceId}`),
        type: isDirectory(item) ? DragType.commonFolder : DragType.commonFile,
      });
    },
    [EventEmitter, resourceId]
  );

  return (
    <div className={styles.localGitRepositoryView}>
      <div className={styles.localGitRepositoryMeta}>
        <div className={styles.localGitRepositoryMetaTitle}>本地 Git 仓库</div>
        <div className={styles.localGitRepositoryMetaRow}>
          <span>当前分支：{repository?.defaultBranch || '未知'}</span>
          {repository?.remoteUrl ? (
            <a href={repository.remoteUrl} target="_blank" rel="noreferrer">
              {repository.remoteUrl}
            </a>
          ) : (
            <span>未配置 origin 远程地址</span>
          )}
        </div>
        <div className={styles.localGitRepositoryMetaNote}>该仓库尚未配置项目仓库记录，因此暂不支持 Changes。</div>
      </div>
      <FileSpaceBlock
        title="项目空间"
        hideHeader
        fillContainer
        loading={loading}
        items={items}
        currentPath={rootPath}
        emptyText="暂无文件"
        resourceEmptyStyle
        childrenByPath={childrenByPath}
        expandedKeys={expandedKeys}
        onExpand={setExpandedKeys}
        onLoadData={loadNode}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={quote}
        showActions={!!resourceId && !!getActionItems && !!onAction}
        getActionItems={getActionItems}
        onAction={onAction}
      />
    </div>
  );
};

const toItems = (nodes: ProjectSpaceTreeNode[], rootPath = '/by/projects/') =>
  nodes.map((node) => ({
    name: node.name,
    path: node.type === 'directory' ? ensureDirectoryPath(`${rootPath}${node.path}`) : `${rootPath}${node.path}`,
    isDir: node.type === 'directory',
    size: node.size,
    lastModified: node.lastModified,
    gitRepository: node.gitRepository,
    repoId: node.repoId,
    defaultBranch: node.defaultBranch,
    changesSupported: node.changesSupported,
    remoteUrl: node.remoteUrl,
  })) as FileBrowserItem[];

type SpaceItem = FileBrowserItem & {
  gitRepository?: boolean;
  repoId?: number;
  defaultBranch?: string;
  changesSupported?: boolean;
  remoteUrl?: string;
};

interface Props {
  projectId: number;
  resourceId?: string | number;
  projectCloudResourceId?: string | number;
  sessionId?: string | number;
  refreshKey?: number;
  onOpenDetail?: (panel: React.ReactNode, options: DetailPanelOptions) => void;
}

const ProjectSpaceTab: React.FC<Props> = ({
  projectId,
  resourceId,
  projectCloudResourceId,
  sessionId,
  refreshKey = 0,
  onOpenDetail,
}) => {
  const intl = useIntl();
  const { EventEmitter } = useGlobal();
  const [items, setItems] = useState<FileBrowserItem[]>([]);
  const [childrenByPath, setChildrenByPath] = useState<Record<string, FileBrowserItem[]>>({});
  const [expandedKeys, setExpandedKeys] = useState<Key[]>([]);
  const [loading, setLoading] = useState(false);
  const [gitDrawerItem, setGitDrawerItem] = useState<SpaceItem | null>(null);
  const [uploading, setUploading] = useState(false);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [createFolderName, setCreateFolderName] = useState('');
  const [renameTarget, setRenameTarget] = useState<SpaceItem | null>(null);
  const [renameName, setRenameName] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);
  const [saveTarget, setSaveTarget] = useState<SpaceItem | null>(null);
  const [savePath, setSavePath] = useState('/');
  const [saveFolders, setSaveFolders] = useState<{ title: string; key: string; isLeaf: boolean }[]>([]);
  const [saveLoading, setSaveLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const clickTimer = useRef<number | null>(null);
  const rootPath = `/by/projects/${projectId}/`;

  const load = useCallback(
    async (relativePath?: string) => {
      setLoading(true);
      try {
        const response = await listProjectSpaceTree({ projectId, path: relativePath });
        const next = sortFileBrowserItems(toItems(unwrapListResponse<ProjectSpaceTreeNode>(response), rootPath));
        const key = relativePath ? ensureDirectoryPath(`${rootPath}${relativePath}`) : rootPath;
        if (relativePath) setChildrenByPath((current) => ({ ...current, [key]: next }));
        else setItems(next);
      } catch (error) {
        console.error('Failed to load project space:', error);
        if (!relativePath) setItems([]);
      } finally {
        setLoading(false);
      }
    },
    [projectId, rootPath]
  );

  useEffect(() => {
    setItems([]);
    setChildrenByPath({});
    setExpandedKeys([]);
    setGitDrawerItem(null);
    void load();
  }, [load, refreshKey]);

  const loadNode = useCallback(
    async (node: FileTreeItem) => {
      if (!isDirectory(node)) return;
      const path = ensureDirectoryPath(node.path);
      if (childrenByPath[path]) return;
      const relative = path.slice(rootPath.length).replace(/\/$/, '');
      await load(relative);
    },
    [childrenByPath, load, rootPath]
  );

  const getNodeExtra = useCallback((raw: FileTreeItem) => {
    const item = raw as SpaceItem;
    if (!item.gitRepository) return null;
    return (
      <span
        className={styles.repoNodeGitActions}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <button
          type="button"
          className={styles.repoGithubButton}
          aria-label="GitHub"
          title="查看仓库"
          onClick={() => setGitDrawerItem(item)}
        >
          <GithubOutlined />
        </button>
      </span>
    );
  }, []);

  const refreshSpace = useCallback(() => {
    setChildrenByPath({});
    setExpandedKeys([]);
    void load();
  }, [load]);

  const handleUpload = useCallback(
    async (files: File[]) => {
      if (!projectId || !files.length || uploading) return;
      setUploading(true);
      try {
        await uploadProjectSpaceFiles(projectId, '', files);
        message.success('上传成功');
        refreshSpace();
      } catch (error: any) {
        message.error(error?.message || error?.msg || '上传失败');
      } finally {
        setUploading(false);
      }
    },
    [projectId, refreshSpace, uploading]
  );

  const handleCreateFolder = useCallback(async () => {
    const name = createFolderName.trim();
    if (!projectId || !name) return;
    try {
      await createProjectSpaceFolder({ projectId, path: name });
      message.success('文件夹创建成功');
      setCreateFolderOpen(false);
      setCreateFolderName('');
      refreshSpace();
    } catch (error: any) {
      message.error(error?.message || error?.msg || '文件夹创建失败');
    }
  }, [createFolderName, projectId, refreshSpace]);

  const openPreview = useCallback(
    (item: FileTreeItem) => {
      if (!onOpenDetail || !resourceId || !canPreviewFile(item)) return;
      onOpenDetail(
        <FilePreviewPanel fileName={item.name} resourceId={`${resourceId}`} path={item.path} source="fileBrowser" />,
        {
          tabKey: `project-space-file:${item.path}`,
          title: item.name,
        }
      );
    },
    [onOpenDetail, resourceId]
  );

  const quote = useCallback(
    (item: FileTreeItem) => {
      if (!resourceId || /^https?:\/\//i.test(item.path)) return;
      EventEmitter.emit('queryInput-insert-item', {
        item: normalizeReferenceItem(item, `${resourceId}`),
        type: isDirectory(item) ? DragType.commonFolder : DragType.commonFile,
      });
    },
    [EventEmitter, resourceId]
  );

  const download = useCallback(
    async (item: SpaceItem) => {
      if (!resourceId) return;
      try {
        const response: any = item.isDir
          ? await downloadFolder(resourceId, ensureDirectoryPath(item.path))
          : await downloadFile(resourceId, item.path);
        const blob = response?.file instanceof Blob ? response.file : new Blob([response?.file || response]);
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = response?.fileName || (item.isDir ? `${item.name}.zip` : item.name);
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
      } catch (error: any) {
        message.error(error?.message || error?.msg || '下载失败');
      }
    },
    [resourceId]
  );

  const remove = useCallback(
    (item: SpaceItem) => {
      if (!resourceId) return;
      Modal.confirm({
        title: '确认删除',
        content: `确定删除“${item.name}”吗？`,
        okButtonProps: { danger: true },
        onOk: async () => {
          await deleteFiles({ resourceId, paths: [item.path] });
          message.success('删除成功');
          refreshSpace();
        },
      });
    },
    [refreshSpace, resourceId]
  );

  const rename = useCallback(async () => {
    if (!renameTarget || !resourceId || !renameName.trim()) return;
    setRenameLoading(true);
    try {
      await renameFile({ resourceId, sourcePath: renameTarget.path, newName: renameName.trim() });
      message.success('重命名成功');
      setRenameTarget(null);
      refreshSpace();
    } catch (error: any) {
      message.error(error?.message || error?.msg || '重命名失败');
    } finally {
      setRenameLoading(false);
    }
  }, [refreshSpace, renameName, renameTarget, resourceId]);

  const openSaveToProject = useCallback(
    async (item: SpaceItem) => {
      if (!projectCloudResourceId || !resourceId || item.isDir) return;
      setSaveTarget(item);
      setSavePath('/');
      setSaveLoading(true);
      try {
        const folders = await queryProjectCloudDrive(projectCloudResourceId, '/');
        setSaveFolders(
          folders
            .filter((folder) => folder.isDir)
            .map((folder) => ({ title: folder.name, key: ensureDirectoryPath(folder.path), isLeaf: false }))
        );
      } catch (error: any) {
        setSaveFolders([]);
        message.error(error?.message || error?.msg || '项目云盘目录加载失败');
      } finally {
        setSaveLoading(false);
      }
    },
    [projectCloudResourceId, resourceId]
  );

  const saveToProject = useCallback(async () => {
    if (!saveTarget || !projectCloudResourceId || !resourceId) return;
    setSaving(true);
    try {
      const response: any = await downloadFile(resourceId, saveTarget.path);
      const blob = response?.file instanceof Blob ? response.file : response;
      if (!(blob instanceof Blob)) throw new Error('文件下载失败');
      const formData = new FormData();
      formData.append('resourceId', String(projectCloudResourceId));
      formData.append('directoryPath', ensureDirectoryPath(savePath));
      formData.append('files', blob, response?.fileName || saveTarget.name);
      await uploadKnowledgeFiles(formData, { responseCfg: { hideErrorTips: true } });
      message.success('已保存到项目云盘');
      setSaveTarget(null);
    } catch (error: any) {
      message.error(error?.message || error?.msg || '保存到项目云盘失败');
    } finally {
      setSaving(false);
    }
  }, [projectCloudResourceId, resourceId, savePath, saveTarget]);

  const onNodeClick = useCallback(
    (event: React.MouseEvent, node: FileTreeItem) => {
      event.stopPropagation();
      if (clickTimer.current !== null) window.clearTimeout(clickTimer.current);
      clickTimer.current = window.setTimeout(() => {
        clickTimer.current = null;
        if (!isDirectory(node)) openPreview(node);
      }, 220);
    },
    [openPreview]
  );

  const actions = useCallback(
    (item: FileBrowserItem): MenuProps['items'] => [
      ...(resourceId ? [{ key: 'quote', label: intl.formatMessage({ id: 'common.quote' }) }] : []),
      ...(canPreviewFile(item)
        ? [{ key: 'preview', label: intl.formatMessage({ id: 'fileBrowser.action.preview' }) }]
        : []),
      { key: 'download', label: '下载' },
      ...(projectCloudResourceId && !isDirectory(item) ? [{ key: 'saveToProject', label: '保存到项目云盘' }] : []),
      { key: 'rename', label: '重命名' },
      { key: 'delete', label: '删除', danger: true },
    ],
    [intl, projectCloudResourceId, resourceId]
  );

  const handleAction = useCallback(
    (key: React.Key, rawItem: FileBrowserItem) => {
      const item = rawItem as SpaceItem;
      if (key === 'quote') quote(item as FileTreeItem);
      if (key === 'preview') openPreview(item as FileTreeItem);
      if (key === 'download') void download(item);
      if (key === 'saveToProject') void openSaveToProject(item);
      if (key === 'rename') {
        setRenameTarget(item);
        setRenameName(item.name);
      }
      if (key === 'delete') remove(item);
    },
    [download, openPreview, openSaveToProject, quote, remove]
  );
  return (
    <div className={styles.detailResourcePanel}>
      <div className={styles.projectSpaceToolbar}>
        <Upload
          multiple
          showUploadList={false}
          beforeUpload={(file, fileList) => {
            if (file === fileList[fileList.length - 1]) void handleUpload(fileList as File[]);
            return false;
          }}
        >
          <Tooltip title="上传文件">
            <Button size="small" aria-label="上传文件" icon={<UploadOutlined />} loading={uploading} />
          </Tooltip>
        </Upload>
        <Tooltip title="新建文件夹">
          <Button
            size="small"
            aria-label="新建文件夹"
            icon={<FolderAddOutlined />}
            onClick={(event) => {
              event.stopPropagation();
              setCreateFolderOpen(true);
            }}
          />
        </Tooltip>
      </div>
      <FileSpaceBlock
        title={intl.formatMessage({ id: 'chatResource.projectSpace' })}
        hideHeader
        fillContainer
        loading={loading}
        items={items}
        currentPath={rootPath}
        emptyText={intl.formatMessage({ id: 'projectSpace.detail.repo.emptyFiles' })}
        resourceEmptyStyle
        childrenByPath={childrenByPath}
        expandedKeys={expandedKeys}
        onExpand={setExpandedKeys}
        onLoadData={loadNode}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={quote}
        showActions={!!resourceId}
        getActionItems={actions}
        onAction={handleAction}
        getNodeExtra={getNodeExtra}
      />
      <Modal
        title="新建文件夹"
        open={createFolderOpen}
        okText="创建"
        cancelText="取消"
        onCancel={() => setCreateFolderOpen(false)}
        onOk={() => void handleCreateFolder()}
      >
        <Input
          autoFocus
          value={createFolderName}
          placeholder="请输入文件夹名称"
          onChange={(event) => setCreateFolderName(event.target.value)}
          onPressEnter={() => void handleCreateFolder()}
        />
      </Modal>
      <Modal
        title="重命名"
        open={!!renameTarget}
        okText="保存"
        cancelText="取消"
        confirmLoading={renameLoading}
        onCancel={() => !renameLoading && setRenameTarget(null)}
        onOk={() => void rename()}
        destroyOnClose
      >
        <Input
          autoFocus
          value={renameName}
          onChange={(event) => setRenameName(event.target.value)}
          onPressEnter={() => void rename()}
        />
      </Modal>
      <Modal
        title="保存到项目云盘"
        open={!!saveTarget}
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
        onCancel={() => !saving && setSaveTarget(null)}
        onOk={() => void saveToProject()}
        destroyOnClose
      >
        <Spin spinning={saveLoading}>
          <Tree
            treeData={[{ title: '根目录', key: '/', children: saveFolders, isLeaf: !saveFolders.length }]}
            expandedKeys={['/']}
            selectedKeys={[savePath]}
            onSelect={(keys) => keys.length && setSavePath(String(keys[0]))}
          />
        </Spin>
      </Modal>
      <Drawer
        open={!!gitDrawerItem}
        width={760}
        placement="right"
        title={gitDrawerItem?.name || 'GitHub 仓库'}
        onClose={() => setGitDrawerItem(null)}
        destroyOnClose
      >
        {gitDrawerItem?.repoId ? (
          <CodesTab
            projectId={projectId}
            resourceId={resourceId}
            sessionId={sessionId}
            refreshKey={refreshKey}
            initialRepoId={gitDrawerItem.repoId}
            showBranchSelector
            codeChangesEnabled={!!sessionId && gitDrawerItem.changesSupported !== false}
            onOpenDetail={onOpenDetail}
          />
        ) : gitDrawerItem ? (
          <LocalGitRepositoryView
            projectId={projectId}
            repositoryPath={gitDrawerItem.path}
            resourceId={resourceId}
            onOpenDetail={onOpenDetail}
            getActionItems={actions}
            onAction={handleAction}
            repository={gitDrawerItem}
          />
        ) : null}
      </Drawer>
    </div>
  );
};

export default ProjectSpaceTab;
