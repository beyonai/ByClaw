import React, { useCallback, useEffect, useMemo, useRef, useState, type Key } from 'react';
import { Drawer, Dropdown, Empty, Input, Spin, message, type MenuProps } from 'antd';
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
  isPathIn,
  normalizeFileBrowserPath,
  normalizeReferenceItem,
  sortFileBrowserItems,
  unwrapListResponse,
} from '@/layout/sider/components/FileSiderPanel/utils';
import type { DetailPanelOptions } from '@/layout/sider/siderContentContext';
import {
  getTaskChanges,
  getTaskFileDiff,
  listAvailableProjectRepos,
  listProjectRepoTree,
  searchProjectRepoTree,
  type AvailableProjectRepo,
  type ProjectRepoTreeNode,
  type DevloopTaskChanges,
  type DevloopTaskFileDiff,
} from '@/service/devloop';
import type { FileBrowserItem } from '@/service/fileBrowser';
import styles from '../index.module.less';

// 单击预览与双击引用共用一次鼠标事件序列，延时用于等待可能到来的第二次点击。
const NODE_CLICK_DELAY = 220;

function toRepoFileItems(nodes: ProjectRepoTreeNode[], rootPath: string, pathPrefix = ''): FileBrowserItem[] {
  const root = ensureDirectoryPath(rootPath);
  const normalizedPrefix = pathPrefix.replace(/^\/+|\/+$/g, '');
  return nodes.map((node) => {
    const nodePath = node.path.replace(/^\/+/, '');
    const relativePath =
      normalizedPrefix && nodePath.startsWith(`${normalizedPrefix}/`)
        ? nodePath.slice(normalizedPrefix.length + 1)
        : nodePath;
    const path = `${root}${relativePath}`;
    const isDir = node.type === 'directory';
    return {
      name: node.name,
      path: isDir ? ensureDirectoryPath(path) : path,
      isDir,
      size: node.size,
      url: node.url,
      downloadUrl: node.downloadUrl,
      url: node.url,
    };
  });
}

interface CodesTabProps {
  projectId: number;
  resourceId?: string | number;
  sessionId?: string | number;
  sessionName?: string;
  refreshKey?: number;
  codeChangesEnabled?: boolean;
  // 提供详情回调时，仓库文件单击即在工作区页签内预览。
  onOpenDetail?: (panel: React.ReactNode, options: DetailPanelOptions) => void;
  // 调用方需要自定义点击行为时覆盖内置的预览逻辑。
  onNodeClick?: (event: React.MouseEvent, node: FileTreeItem) => void;
}

type DevloopProjectRepo = AvailableProjectRepo;

type ProjectDetailTranslate = (id: string, values?: Record<string, string | number>) => string;

// GitHub 文件变更状态映射为 IDE 常见的新增、修改、删除和重命名标识。
const FILE_CHANGE_META: Record<string, { letter: string; labelId: string; className: string }> = {
  added: { letter: 'A', labelId: 'codeChanges.status.added', className: 'fileChangeAdded' },
  modified: { letter: 'M', labelId: 'codeChanges.status.modified', className: 'fileChangeModified' },
  changed: { letter: 'M', labelId: 'codeChanges.status.modified', className: 'fileChangeModified' },
  removed: { letter: 'D', labelId: 'codeChanges.status.removed', className: 'fileChangeRemoved' },
  renamed: { letter: 'R', labelId: 'codeChanges.status.renamed', className: 'fileChangeRenamed' },
  copied: { letter: 'C', labelId: 'codeChanges.status.copied', className: 'fileChangeRenamed' },
};

const getFileChangeMeta = (status?: string) =>
  FILE_CHANGE_META[(status || 'modified').toLowerCase()] || FILE_CHANGE_META.modified;

const splitFilePath = (path: string) => {
  const index = path.lastIndexOf('/');
  return index >= 0 ? { name: path.slice(index + 1), dir: path.slice(0, index) } : { name: path, dir: '' };
};

type DiffLineType = 'meta' | 'hunk' | 'add' | 'del' | 'context';

const classifyDiffLine = (line: string): DiffLineType => {
  if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
    return 'meta';
  }
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'del';
  return 'context';
};

const parseDiffLines = (diff?: string | null): { type: DiffLineType; text: string }[] => {
  if (!diff) return [];
  return diff.split('\n').map((text) => ({ type: classifyDiffLine(text), text }));
};

const CodesTab: React.FC<CodesTabProps> = ({
  projectId,
  resourceId,
  sessionId,
  sessionName,
  refreshKey = 0,
  codeChangesEnabled = false,
  onOpenDetail,
  onNodeClick,
}) => {
  const intl = useIntl();
  const { EventEmitter } = useGlobal();
  const t: ProjectDetailTranslate = useCallback(
    (id, values) => intl.formatMessage({ id: `projectSpace.detail.${id}` }, values),
    [intl]
  );
  const [repos, setRepos] = useState<DevloopProjectRepo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [selectedRepoId, setSelectedRepoId] = useState<number | null>(null);
  const [repoFilesMap, setRepoFilesMap] = useState<Record<string, FileBrowserItem[]>>({});
  const [repoLoadingMap, setRepoLoadingMap] = useState<Record<string, boolean>>({});
  const [repoSearchValueMap, setRepoSearchValueMap] = useState<Record<string, string>>({});
  const [childrenByPath, setChildrenByPath] = useState<Record<string, FileBrowserItem[]>>({});
  const [expandedKeys, setExpandedKeys] = useState<Key[]>([]);
  const [taskChanges, setTaskChanges] = useState<DevloopTaskChanges | null>(null);
  const [taskChangesLoading, setTaskChangesLoading] = useState(false);
  const [repoChangesViewMap, setRepoChangesViewMap] = useState<Record<string, boolean>>({});
  const [diffModalFile, setDiffModalFile] = useState<string | null>(null);
  const [diffModalData, setDiffModalData] = useState<DevloopTaskFileDiff | null>(null);
  const [diffModalLoading, setDiffModalLoading] = useState(false);
  const repoRequestSeqRef = useRef<Record<string, number>>({});
  const taskChangesRequestSeqRef = useRef(0);
  const clickTimerRef = useRef<number | null>(null);
  const normalizedResourceId = resourceId === undefined || resourceId === '' ? undefined : `${resourceId}`;

  const selectedRepo = useMemo(
    () => repos.find((repo) => repo.repoId === selectedRepoId) || repos[0],
    [repos, selectedRepoId]
  );

  const fetchRepoFiles = useCallback(
    async (repo: DevloopProjectRepo, rootPath: string) => {
      if (!rootPath) return;
      const repoKey = `${repo.repoId}`;
      const requestSeq = (repoRequestSeqRef.current[repoKey] || 0) + 1;
      repoRequestSeqRef.current[repoKey] = requestSeq;
      setRepoLoadingMap((current) => ({ ...current, [repoKey]: true }));
      try {
        const response = await listProjectRepoTree({
          projectId,
          repoId: repo.repoId,
          sessionId,
        });
        if (requestSeq === repoRequestSeqRef.current[repoKey]) {
          setRepoFilesMap((current) => ({
            ...current,
            [repoKey]: sortFileBrowserItems(
              toRepoFileItems(unwrapListResponse<ProjectRepoTreeNode>(response), rootPath)
            ),
          }));
        }
      } catch (error) {
        // 单个仓库读取失败时保留其它仓库，刷新按钮仍可单独重试当前仓库。
        console.error('Failed to load project repository files:', error);
        if (requestSeq === repoRequestSeqRef.current[repoKey]) {
          setRepoFilesMap((current) => ({ ...current, [repoKey]: [] }));
        }
      } finally {
        if (requestSeq === repoRequestSeqRef.current[repoKey]) {
          setRepoLoadingMap((current) => ({ ...current, [repoKey]: false }));
        }
      }
    },
    [projectId]
  );

  const fetchTaskChanges = useCallback(async () => {
    const requestSeq = taskChangesRequestSeqRef.current + 1;
    taskChangesRequestSeqRef.current = requestSeq;
    if (!codeChangesEnabled || !sessionId || !selectedRepo || selectedRepo.changesSupported === false) {
      setTaskChanges(null);
      return;
    }
    setTaskChangesLoading(true);
    try {
      const response = await getTaskChanges(Number(sessionId), selectedRepo.repoId);
      if (requestSeq === taskChangesRequestSeqRef.current) setTaskChanges(response || null);
    } catch (error) {
      console.error('Failed to load task changes:', error);
      if (requestSeq === taskChangesRequestSeqRef.current) setTaskChanges(null);
    } finally {
      if (requestSeq === taskChangesRequestSeqRef.current) setTaskChangesLoading(false);
    }
  }, [codeChangesEnabled, selectedRepo, sessionId]);

  const fetchRepos = useCallback(async () => {
    if (!projectId) return;
    setReposLoading(true);
    try {
      const response = await listAvailableProjectRepos(projectId, sessionId);
      const nextRepos = Array.isArray(response) ? response : [];
      setRepos(nextRepos);
      const nextSelectedRepo = nextRepos[0];
      setSelectedRepoId(nextSelectedRepo?.repoId || null);
      if (nextSelectedRepo?.path && sessionId) {
        await fetchRepoFiles(nextSelectedRepo, ensureDirectoryPath(nextSelectedRepo.path));
      }
    } catch (error) {
      console.error('Failed to load project repositories:', error);
      setRepos([]);
    } finally {
      setReposLoading(false);
    }
  }, [fetchRepoFiles, projectId, sessionId]);

  useEffect(() => {
    setRepos([]);
    setSelectedRepoId(null);
    setRepoFilesMap({});
    setRepoLoadingMap({});
    setRepoSearchValueMap({});
    setChildrenByPath({});
    setExpandedKeys([]);
    setRepoChangesViewMap({});
    setDiffModalFile(null);
    setDiffModalData(null);
    repoRequestSeqRef.current = {};
    taskChangesRequestSeqRef.current += 1;
    void fetchRepos();
  }, [fetchRepos, refreshKey]);

  useEffect(() => {
    setRepoChangesViewMap({});
    void fetchTaskChanges();
  }, [fetchTaskChanges, refreshKey]);

  useEffect(
    () => () => {
      if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current);
    },
    []
  );

  const loadRepoTreeNode = useCallback(
    async (node: FileTreeItem) => {
      if (!isDirectory(node)) return;
      const directoryPath = ensureDirectoryPath(normalizeFileBrowserPath(node.path));
      if (childrenByPath[directoryPath]) return;
      try {
        const rootPath = selectedRepo?.path ? ensureDirectoryPath(selectedRepo.path) : null;
        if (!rootPath) return;
        const relativePath = directoryPath.slice(ensureDirectoryPath(rootPath).length).replace(/\/$/, '');
        const repoId = selectedRepo?.repoId;
        if (!repoId) return;
        const response = await listProjectRepoTree({
          projectId,
          repoId,
          sessionId,
          path: relativePath || undefined,
        });
        setChildrenByPath((current) => ({
          ...current,
          [directoryPath]: sortFileBrowserItems(
            toRepoFileItems(unwrapListResponse<ProjectRepoTreeNode>(response), directoryPath, relativePath)
          ),
        }));
      } catch (error) {
        console.error('Failed to load project repository directory:', error);
        setChildrenByPath((current) => ({ ...current, [directoryPath]: [] }));
      }
    },
    [childrenByPath, projectId, selectedRepo, sessionId]
  );

  const openFilePreview = useCallback(
    (item: FileTreeItem) => {
      if (!onOpenDetail || !normalizedResourceId) return;
      if (!canPreviewFile(item)) {
        message.warning(intl.formatMessage({ id: 'fileBrowser.preview.unavailable' }));
        return;
      }
      const remoteUrl = `${(item as any).url || ''}`.trim();
      const remoteDownloadUrl = `${(item as any).downloadUrl || ''}`.trim();
      const fileUrl = /^https?:\/\//i.test(remoteDownloadUrl)
        ? remoteDownloadUrl
        : /^https?:\/\//i.test(remoteUrl)
        ? remoteUrl
        : undefined;
      // 预览挂在资源工作区页签上，同一路径复用同一个页签而不是重复打开。
      onOpenDetail(
        <FilePreviewPanel
          fileName={item.name}
          resourceId={normalizedResourceId}
          path={item.path}
          fileUrl={fileUrl}
          source="fileBrowser"
        />,
        { tabKey: `repo-file:${item.path}`, title: item.name }
      );
    },
    [intl, normalizedResourceId, onOpenDetail]
  );

  const quoteFile = useCallback(
    (item: FileBrowserItem) => {
      if (!normalizedResourceId) return;
      // 外部仓库链接仅用于查看，不参与聊天资源引用。
      if (/^https?:\/\//i.test(`${(item as any).url || ''}`)) return;
      EventEmitter.emit('queryInput-insert-item', {
        item: normalizeReferenceItem(item, normalizedResourceId),
        type: isDirectory(item) ? DragType.commonFolder : DragType.commonFile,
      });
    },
    [EventEmitter, normalizedResourceId]
  );

  const getActionItems = useCallback(
    (item: FileBrowserItem): MenuProps['items'] => {
      if (!normalizedResourceId) return [];
      if (/^https?:\/\//i.test(`${item.url || ''}`.trim())) return [];
      return [
        {
          key: 'quote',
          label: intl.formatMessage({ id: 'common.quote' }),
        },
      ];
    },
    [intl, normalizedResourceId]
  );

  const getTooltipPath = useCallback((item: FileBrowserItem) => {
    const url = `${(item as any).url || ''}`.trim();
    return /^https?:\/\//i.test(url) ? url : undefined;
  }, []);

  const handleAction = useCallback(
    (key: Key, item: FileBrowserItem) => {
      if (key === 'quote') quoteFile(item);
    },
    [quoteFile]
  );

  const handleNodeClick = useCallback(
    (event: React.MouseEvent, node: FileTreeItem) => {
      if (onNodeClick) {
        onNodeClick(event, node);
        return;
      }
      event.stopPropagation();
      if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = window.setTimeout(() => {
        clickTimerRef.current = null;
        if (!isDirectory(node)) openFilePreview(node);
      }, NODE_CLICK_DELAY);
    },
    [onNodeClick, openFilePreview]
  );

  const handleNodeDoubleClick = useCallback(
    (node: FileTreeItem) => {
      if (clickTimerRef.current !== null) {
        window.clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      quoteFile(node);
    },
    [quoteFile]
  );

  const openFileDiff = useCallback(
    async (filePath: string, repoId?: number) => {
      if (!sessionId) return;
      setDiffModalFile(filePath);
      setDiffModalData(null);
      setDiffModalLoading(true);
      try {
        const response = await getTaskFileDiff(Number(sessionId), filePath, repoId);
        setDiffModalData(response || null);
      } catch (error) {
        console.error('Failed to load file diff:', error);
        setDiffModalData(null);
      } finally {
        setDiffModalLoading(false);
      }
    },
    [sessionId]
  );

  const closeFileDiff = useCallback(() => {
    setDiffModalFile(null);
    setDiffModalData(null);
  }, []);

  const searchRepoFiles = useCallback(
    async (repo: DevloopProjectRepo, keyword: string) => {
      if (!repo.path) return;
      const repoKey = `${repo.repoId}`;
      const nextKeyword = keyword.trim();
      if (!nextKeyword) {
        await fetchRepoFiles(repo, ensureDirectoryPath(repo.path));
        return;
      }

      const rootPath = ensureDirectoryPath(repo.path);
      const requestSeq = (repoRequestSeqRef.current[repoKey] || 0) + 1;
      repoRequestSeqRef.current[repoKey] = requestSeq;
      setRepoLoadingMap((current) => ({ ...current, [repoKey]: true }));
      try {
        const repoId = repo.repoId;
        const response = await searchProjectRepoTree({
          projectId,
          repoId,
          sessionId,
          keyword: nextKeyword,
        });
        if (requestSeq === repoRequestSeqRef.current[repoKey]) {
          setRepoFilesMap((current) => ({
            ...current,
            [repoKey]: sortFileBrowserItems(
              toRepoFileItems(unwrapListResponse<ProjectRepoTreeNode>(response), rootPath)
            ),
          }));
          setChildrenByPath((current) =>
            Object.fromEntries(Object.entries(current).filter(([path]) => !isPathIn(path, rootPath)))
          );
          setExpandedKeys((current) => current.filter((key) => !isPathIn(`${key}`, rootPath)));
        }
      } catch (error) {
        console.error('Failed to search project repository files:', error);
        if (requestSeq === repoRequestSeqRef.current[repoKey]) {
          setRepoFilesMap((current) => ({ ...current, [repoKey]: [] }));
        }
      } finally {
        if (requestSeq === repoRequestSeqRef.current[repoKey]) {
          setRepoLoadingMap((current) => ({ ...current, [repoKey]: false }));
        }
      }
    },
    [fetchRepoFiles, projectId, sessionId]
  );

  const renderCodeChanges = () => {
    const empty = (id: string, values?: Record<string, string | number>) => (
      <div className={styles.codeChangeEmpty}>
        {taskChangesLoading ? (
          <Spin size="small" />
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t(id, values)} />
        )}
      </div>
    );

    let body: React.ReactNode;
    const status = taskChanges?.status;
    if (!sessionId) {
      body = empty('codeChanges.selectSession');
    } else if (taskChangesLoading && !taskChanges) {
      body = empty('codeChanges.loading');
    } else if (!taskChanges || status === 'http_error') {
      body = taskChanges?.message ? (
        <div className={styles.codeChangeEmpty}>
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={taskChanges.message} />
        </div>
      ) : (
        empty('codeChanges.unavailable')
      );
    } else if (status === 'no_repo') {
      body = empty('codeChanges.noRepository');
    } else if (status === 'no_token') {
      body = empty('codeChanges.noToken');
    } else if (status === 'branch_not_found') {
      body = empty('codeChanges.branchNotFound', { branch: taskChanges.headBranch || '-' });
    } else if (!taskChanges.files?.length) {
      body = empty('codeChanges.noChanges');
    } else {
      body = (
        <div className={styles.codeChangeList}>
          {taskChanges.files.map((file) => {
            const meta = getFileChangeMeta(file.status);
            const { name, dir } = splitFilePath(file.filename);
            const renamedFrom =
              file.status?.toLowerCase() === 'renamed' && file.previousFilename ? file.previousFilename : '';
            const isLocal = taskChanges.source === 'local';
            const inner = (
              <>
                <span className={`${styles.codeChangeBadge} ${styles[meta.className]}`} title={t(meta.labelId)}>
                  {meta.letter}
                </span>
                <div className={styles.codeChangeInfo}>
                  <strong className={styles.codeChangeName}>{name}</strong>
                  <span
                    className={styles.codeChangePath}
                    title={renamedFrom ? `${renamedFrom} → ${file.filename}` : file.filename}
                  >
                    {renamedFrom ? `${renamedFrom} → ${file.filename}` : dir || file.filename}
                  </span>
                </div>
                <div className={styles.codeChangeStat}>
                  {file.additions > 0 && <span className={styles.codeChangeAdd}>+{file.additions}</span>}
                  {file.deletions > 0 && <span className={styles.codeChangeDel}>-{file.deletions}</span>}
                </div>
              </>
            );
            if (file.blobUrl) {
              return (
                <a
                  className={`${styles.codeChangeItem} ${styles.codeChangeItemLink}`}
                  key={file.filename}
                  href={file.blobUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {inner}
                </a>
              );
            }
            if (isLocal) {
              return (
                <button
                  type="button"
                  aria-label={file.filename}
                  className={`${styles.codeChangeItem} ${styles.codeChangeItemLink} ${styles.codeChangeItemButton}`}
                  key={file.filename}
                  onClick={() => void openFileDiff(file.filename, file.repoId ?? taskChanges.repoId)}
                >
                  {inner}
                </button>
              );
            }
            return (
              <div className={styles.codeChangeItem} key={file.filename}>
                {inner}
              </div>
            );
          })}
        </div>
      );
    }

    const branchLabel = taskChanges?.headBranch || sessionName || '';
    return (
      <div className={`${styles.codeChangeCard} ${styles.repoCodeChangeCard}`}>
        <div className={styles.codeChangeHeader}>
          <div className={styles.codeChangeHeaderMain}>
            <strong>{t('codeChanges.title')}</strong>
            {branchLabel ? (
              taskChanges?.compareUrl ? (
                <a
                  className={`${styles.codeChangeBranch} ${styles.codeChangeBranchLink}`}
                  href={taskChanges.compareUrl}
                  target="_blank"
                  rel="noreferrer"
                  title={t('codeChanges.openInGitHub')}
                >
                  {branchLabel}
                </a>
              ) : (
                <span className={styles.codeChangeBranch}>{branchLabel}</span>
              )
            ) : null}
          </div>
          {status === 'ok' && taskChanges?.files?.length ? (
            <span className={styles.codeChangeCount}>{taskChanges.files.length}</span>
          ) : null}
        </div>
        {body}
      </div>
    );
  };

  const renderFileDiffDrawer = () => {
    const open = !!diffModalFile;
    const lines = parseDiffLines(diffModalData?.diff);
    const status = diffModalData?.status;
    const hasDiff = status === 'ok' && lines.some((line) => line.type === 'add' || line.type === 'del');
    const fileName = diffModalFile ? splitFilePath(diffModalFile).name : '';
    return (
      <Drawer
        open={open}
        onClose={closeFileDiff}
        placement="right"
        width={760}
        title={
          <div className={styles.diffModalTitle}>
            <span className={styles.diffModalName}>{fileName}</span>
            {diffModalFile ? <span className={styles.diffModalPath}>{diffModalFile}</span> : null}
          </div>
        }
        className={styles.diffDrawer}
      >
        {diffModalLoading ? (
          <div className={styles.diffModalEmpty}>
            <Spin />
          </div>
        ) : !diffModalData || status !== 'ok' ? (
          <div className={styles.diffModalEmpty}>{diffModalData?.message || t('codeChanges.diffUnavailable')}</div>
        ) : !hasDiff ? (
          <div className={styles.diffModalEmpty}>{t('codeChanges.diffEmpty')}</div>
        ) : (
          <div className={styles.diffModalBody}>
            {lines.map((line, index) => {
              if (line.type === 'meta') return null;
              let className = styles.diffLineContext;
              if (line.type === 'add') className = styles.diffLineAdd;
              else if (line.type === 'del') className = styles.diffLineDel;
              else if (line.type === 'hunk') className = styles.diffLineHunk;
              return (
                <div className={`${styles.diffLine} ${className}`} key={index}>
                  {line.text || ' '}
                </div>
              );
            })}
          </div>
        )}
      </Drawer>
    );
  };

  const switchRepository = useCallback(
    async (repoId: number) => {
      const repo = repos.find((item) => item.repoId === repoId);
      if (!repo || repo.repoId === selectedRepoId) return;
      setSelectedRepoId(repo.repoId);
      setChildrenByPath({});
      setExpandedKeys([]);
      setDiffModalFile(null);
      setDiffModalData(null);
      setTaskChanges(null);
      if (!repoFilesMap[`${repo.repoId}`] && repo.path) {
        await fetchRepoFiles(repo, ensureDirectoryPath(repo.path));
      }
    },
    [fetchRepoFiles, repoFilesMap, repos, selectedRepoId]
  );

  if (!selectedRepo) {
    return (
      <div className={styles.detailResourcePanel}>
        <div className={styles.detailReposEmpty}>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={intl.formatMessage({
              id: reposLoading ? 'projectSpace.detail.repo.loading' : 'projectSpace.detail.repo.emptyRepositories',
            })}
          />
        </div>
      </div>
    );
  }

  const repo = selectedRepo;
  const repoKey = `${repo.repoId}`;
  const currentPath = ensureDirectoryPath(repo.path);
  const showChangesView = !!repoChangesViewMap[repoKey];
  const taskChangeCount = taskChanges?.files?.length || 0;
  const loading = showChangesView ? taskChangesLoading : !!repoLoadingMap[repoKey];
  const repoMenuItems: MenuProps['items'] = repos.map((item) => ({
    key: `${item.repoId}`,
    label: item.repoFullName,
  }));
  const branchLabel = taskChanges?.headBranch?.trim() || '';
  const branchBadge = branchLabel ? (
    taskChanges?.compareUrl ? (
      <a
        className={`${styles.repoBranch} ${styles.repoBranchLink}`}
        href={taskChanges.compareUrl}
        target="_blank"
        rel="noreferrer"
        title={branchLabel}
        aria-label={branchLabel}
      >
        <BranchesOutlined />
        <span className={styles.repoBranchName}>{branchLabel}</span>
      </a>
    ) : (
      <span className={styles.repoBranch} title={branchLabel} aria-label={branchLabel}>
        <BranchesOutlined />
        <span className={styles.repoBranchName}>{branchLabel}</span>
      </span>
    )
  ) : null;

  return (
    <div className={styles.detailResourcePanel}>
      <FileSpaceBlock
        key={repoKey}
        title={repo.repoFullName}
        fillContainer
        headerExtra={
          <>
            {branchBadge}
            {repos.length > 1 ? (
              <Dropdown
                menu={{ items: repoMenuItems, onClick: ({ key }) => void switchRepository(Number(key)) }}
                trigger={['click']}
              >
                <button type="button" className={styles.repoSelector} aria-label={repo.repoFullName}>
                  <DownOutlined />
                </button>
              </Dropdown>
            ) : null}
            {repo.changesSupported !== false && (
              <button
                type="button"
                className={`${styles.repoChangesButton} ${showChangesView ? styles.repoChangesButtonActive : ''}`}
                aria-label={t(showChangesView ? 'repo.showFiles' : 'repo.showCodeChanges')}
                onClick={() => setRepoChangesViewMap((current) => ({ ...current, [repoKey]: !current[repoKey] }))}
              >
                <BranchesOutlined />
                {taskChangeCount > 0 && <span className={styles.repoChangesCount}>{taskChangeCount}</span>}
              </button>
            )}
          </>
        }
        contentBefore={
          <div className={styles.detailRepoSearch}>
            <Input.Search
              allowClear
              value={repoSearchValueMap[repoKey] || ''}
              placeholder={intl.formatMessage({ id: 'projectSpace.detail.repo.searchPlaceholder' })}
              loading={!!repoLoadingMap[repoKey]}
              onChange={(event) => setRepoSearchValueMap((current) => ({ ...current, [repoKey]: event.target.value }))}
              onSearch={(value) => void searchRepoFiles(repo, value)}
              onClear={() => void searchRepoFiles(repo, '')}
            />
          </div>
        }
        alternateContent={renderCodeChanges()}
        showAlternateContent={showChangesView}
        loading={loading}
        items={repoFilesMap[repoKey] || []}
        currentPath={currentPath}
        emptyText={intl.formatMessage({
          id: sessionId ? 'projectSpace.detail.repo.emptyFiles' : 'projectSpace.detail.repo.emptySession',
        })}
        resourceEmptyStyle
        childrenByPath={childrenByPath}
        expandedKeys={expandedKeys}
        onExpand={setExpandedKeys}
        onLoadData={loadRepoTreeNode}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        showActions={!!normalizedResourceId}
        getActionItems={getActionItems}
        onAction={handleAction}
        getTooltipPath={getTooltipPath}
      />
      {renderFileDiffDrawer()}
    </div>
  );
};

export default CodesTab;
