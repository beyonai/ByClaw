import React, { useCallback, useEffect, useRef, useState, type Key } from 'react';
import { Button, Drawer, Input, Modal, Tooltip, Upload, message, type MenuProps } from 'antd';
import { FolderAddOutlined, GithubOutlined, ReloadOutlined, UploadOutlined } from '@ant-design/icons';
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
import type { FileBrowserItem } from '@/service/fileBrowser';
import styles from './index.module.less';

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
  })) as FileBrowserItem[];

type SpaceItem = FileBrowserItem & {
  gitRepository?: boolean;
  repoId?: number;
  defaultBranch?: string;
  changesSupported?: boolean;
};

interface Props {
  projectId: number;
  resourceId?: string | number;
  sessionId?: string | number;
  refreshKey?: number;
  onOpenDetail?: (panel: React.ReactNode, options: DetailPanelOptions) => void;
}

const ProjectSpaceTab: React.FC<Props> = ({ projectId, resourceId, sessionId, refreshKey = 0, onOpenDetail }) => {
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
    (): MenuProps['items'] => [{ key: 'quote', label: intl.formatMessage({ id: 'common.quote' }) }],
    [intl]
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
        <Tooltip title="刷新">
          <Button size="small" aria-label="刷新" icon={<ReloadOutlined />} onClick={refreshSpace} />
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
        onAction={() => undefined}
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
        ) : null}
      </Drawer>
    </div>
  );
};

export default ProjectSpaceTab;
