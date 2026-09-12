import React, { useCallback, useEffect, useRef, useState, type Key } from 'react';
import { Dropdown, Popover, type MenuProps } from 'antd';
import { BranchesOutlined, DownOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import FilePreviewPanel from '@/components/ChatLayoutComp/ChatResourceWorkspace/FilePreviewPanel';
import { DragType } from '@/components/QueryInput/withDrag';
import useGlobal from '@/hooks/useGlobal';
import FileSpaceBlock from '@/layout/sider/components/FileSiderPanel/components/FileSpaceBlock';
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
  getTaskChanges,
  listProjectRepoBranches,
  listProjectSpaceTree,
  type DevloopTaskChanges,
  type ProjectRepoBranch,
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
  const [gitBranches, setGitBranches] = useState<Record<string, ProjectRepoBranch[]>>({});
  const [selectedBranch, setSelectedBranch] = useState<Record<string, string>>({});
  const [changes, setChanges] = useState<Record<string, DevloopTaskChanges | null>>({});
  const [changesOpen, setChangesOpen] = useState<Record<string, boolean>>({});
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
    setChanges({});
    setChangesOpen({});
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

  const getGitKey = (item: SpaceItem) => `${item.path}`;
  const loadChanges = useCallback(
    async (item: SpaceItem) => {
      if (!sessionId || !item.repoId) return;
      const result = await getTaskChanges(Number(sessionId), item.repoId).catch(() => null);
      setChanges((current) => ({ ...current, [getGitKey(item)]: result }));
    },
    [sessionId]
  );

  const showBranches = useCallback(
    async (item: SpaceItem) => {
      if (!item.repoId) return;
      const key = getGitKey(item);
      if (gitBranches[key]) return;
      const result = await listProjectRepoBranches(item.repoId).catch(() => []);
      setGitBranches((current) => ({ ...current, [key]: result }));
    },
    [gitBranches]
  );

  const getNodeExtra = useCallback(
    (raw: FileTreeItem) => {
      const item = raw as SpaceItem;
      if (!item.gitRepository) return null;
      const key = getGitKey(item);
      const branch = selectedBranch[key] || item.defaultBranch || '';
      const branchItems: MenuProps['items'] = (gitBranches[key] || []).map((entry) => ({
        key: entry.name,
        label: entry.name,
        onClick: () => setSelectedBranch((current) => ({ ...current, [key]: entry.name })),
      }));
      const count = changes[key]?.files?.length || 0;
      const changeFiles = (changes[key]?.files || []).map((file) => (
        <div className={styles.codeChangePopoverItem} key={file.filename}>
          {file.filename}
        </div>
      ));
      return (
        <span className={styles.repoNodeGitActions} onClick={(event) => event.stopPropagation()}>
          <Dropdown
            menu={{ items: branchItems }}
            trigger={['click']}
            onOpenChange={(open) => open && void showBranches(item)}
          >
            <button type="button" className={styles.repoBranch} aria-label={branch || 'branch'}>
              <BranchesOutlined />
              <span className={styles.repoBranchName}>{branch || 'branch'}</span>
              <DownOutlined />
            </button>
          </Dropdown>
          {item.changesSupported !== false && item.repoId ? (
            <Popover
              trigger="click"
              open={!!changesOpen[key]}
              onOpenChange={(open) => {
                setChangesOpen((current) => ({ ...current, [key]: open }));
                if (open) void loadChanges(item);
              }}
              content={<div className={styles.codeChangePopover}>{changeFiles.length ? changeFiles : '暂无变更'}</div>}
            >
              <button type="button" className={styles.repoChangesButton} aria-label="changes">
                <BranchesOutlined />
                {count > 0 && <span className={styles.repoChangesCount}>{count}</span>}
              </button>
            </Popover>
          ) : null}
        </span>
      );
    },
    [changes, changesOpen, gitBranches, loadChanges, selectedBranch, showBranches]
  );

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
      <FileSpaceBlock
        title={intl.formatMessage({ id: 'chatResource.projectSpace' })}
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
    </div>
  );
};

export default ProjectSpaceTab;
