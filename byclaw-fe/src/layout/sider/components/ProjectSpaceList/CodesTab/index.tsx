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
  getLocalRepoChanges,
  getLocalRepoFileDiff,
  getTaskChanges,
  getTaskFileDiff,
  listAvailableProjectRepos,
  listProjectRepoBranches,
  listProjectRepoTree,
  searchProjectRepoTree,
  type AvailableProjectRepo,
  type GitSourceParams,
  type ProjectRepoBranch,
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
    };
  });
}

/**
 * 数据源在组件内的稳定键。数据库仓库用 repoId，项目空间本地仓库用相对路径，
 * 两类前缀不同因此不会互相覆盖 state 分片。
 */
export const sourceKey = (repo: Pick<AvailableProjectRepo, 'repoId' | 'repositoryPath'>) =>
  repo.repoId ? `repo:${repo.repoId}` : `path:${`${repo.repositoryPath || ''}`.replace(/^\/+|\/+$/g, '')}`;

/** 本地数据源的项目空间相对路径，Changes/diff 请求用它定位仓库。 */
const localRepositoryPath = (repo?: Pick<AvailableProjectRepo, 'repositoryPath'>) =>
  `${repo?.repositoryPath || ''}`.replace(/^\/+|\/+$/g, '');

/** 请求时二选一的定位参数：本地仓库不允许伪造 repoId。 */
const sourceParams = (repo: Pick<AvailableProjectRepo, 'repoId' | 'repositoryPath'>): GitSourceParams =>
  repo.repoId ? { repoId: repo.repoId } : { repositoryPath: repo.repositoryPath };

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
  initialRepoId?: number;
  showBranchSelector?: boolean;

  /** 提供时跳过 available-list 请求，直接使用注入的数据源（项目空间本地仓库场景）。 */
  injectedRepos?: AvailableProjectRepo[];
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
  initialRepoId,
  showBranchSelector = false,
  injectedRepos,
}) => {
  const intl = useIntl();
  const { EventEmitter } = useGlobal();
  const t: ProjectDetailTranslate = useCallback(
    (id, values) => intl.formatMessage({ id: `projectSpace.detail.${id}` }, values),
    [intl]
  );
  const [repos, setRepos] = useState<DevloopProjectRepo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [selectedSourceKey, setSelectedSourceKey] = useState<string | null>(null);
  const [repoBranchesMap, setRepoBranchesMap] = useState<Record<string, ProjectRepoBranch[]>>({});
  const [selectedBranchMap, setSelectedBranchMap] = useState<Record<string, string>>({});
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
  // 当前会话项目代码来自项目级 clone 目录；没有员工资源 ID 时使用项目 ID 作为引用资源标识。
  const normalizedResourceId =
    resourceId === undefined || resourceId === '' ? (projectId ? `${projectId}` : undefined) : `${resourceId}`;

  const selectedRepo = useMemo(
    () => repos.find((repo) => sourceKey(repo) === selectedSourceKey) || repos[0],
    [repos, selectedSourceKey]
  );

  const fetchRepoFiles = useCallback(
    async (repo: AvailableProjectRepo, rootPath: string, ref?: string) => {
      if (!rootPath) return;
      const repoKey = sourceKey(repo);
      const requestSeq = (repoRequestSeqRef.current[repoKey] || 0) + 1;
      repoRequestSeqRef.current[repoKey] = requestSeq;
      setRepoLoadingMap((current) => ({ ...current, [repoKey]: true }));
      try {
        const response = await listProjectRepoTree({
          projectId,
          ...sourceParams(repo),
          ref: showBranchSelector ? ref || selectedBranchMap[repoKey] || repo.defaultBranch : undefined,
          // 项目代码使用项目级 clone 目录；当前会话只用于权限和变更上下文。
          sessionId: undefined,
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
    [projectId, selectedBranchMap, showBranchSelector]
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
      // 已登记仓库的变更按会话任务口径查询；本地发现的仓库没有 repoId，走项目空间 local-changes。
      const response = await (selectedRepo.repoId
        ? getTaskChanges(Number(sessionId), selectedRepo.repoId)
        : getLocalRepoChanges({ projectId, repositoryPath: localRepositoryPath(selectedRepo), sessionId }));
      if (requestSeq === taskChangesRequestSeqRef.current) setTaskChanges(response || null);
    } catch (error) {
      console.error('Failed to load task changes:', error);
      if (requestSeq === taskChangesRequestSeqRef.current) setTaskChanges(null);
    } finally {
      if (requestSeq === taskChangesRequestSeqRef.current) setTaskChangesLoading(false);
    }
  }, [codeChangesEnabled, projectId, selectedRepo, sessionId]);

  const fetchRepos = useCallback(async () => {
    if (!projectId) return;
    setReposLoading(true);
    try {
      // 注入数据源时不再拉全项目仓库列表：项目空间本地仓库只需要它自己这一个数据源。
      const response = injectedRepos || (await listAvailableProjectRepos(projectId, sessionId));
      const nextRepos = Array.isArray(response) ? response : [];
      setRepos(nextRepos);
      const nextSelectedRepo = nextRepos.find((repo) => repo.repoId === initialRepoId) || nextRepos[0];
      setSelectedSourceKey(nextSelectedRepo ? sourceKey(nextSelectedRepo) : null);
      if (nextSelectedRepo?.path && (sessionId || showBranchSelector)) {
        await fetchRepoFiles(nextSelectedRepo, ensureDirectoryPath(nextSelectedRepo.path));
      }
    } catch (error) {
      console.error('Failed to load project repositories:', error);
      setRepos([]);
    } finally {
      setReposLoading(false);
    }
  }, [fetchRepoFiles, initialRepoId, injectedRepos, projectId, sessionId, showBranchSelector]);

  useEffect(() => {
    setRepos([]);
    setSelectedSourceKey(null);
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
        if (!selectedRepo) return;
        const response = await listProjectRepoTree({
          projectId,
          ...sourceParams(selectedRepo),
          sessionId,
          ref: showBranchSelector
            ? selectedBranchMap[sourceKey(selectedRepo)] || selectedRepo.defaultBranch
            : undefined,
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
    [childrenByPath, projectId, selectedBranchMap, selectedRepo, sessionId, showBranchSelector]
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
      let fileUrl: string | undefined;
      if (/^https?:\/\//i.test(remoteDownloadUrl)) fileUrl = remoteDownloadUrl;
      else if (/^https?:\/\//i.test(remoteUrl)) fileUrl = remoteUrl;
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
        // 本地发现的仓库没有 repoId，diff 走项目空间接口；已登记仓库继续用会话任务口径。
        const localDiffParams = {
          projectId,
          repositoryPath: localRepositoryPath(selectedRepo),
          filePath,
          sessionId,
        };
        const response = await (selectedRepo?.repoId
          ? getTaskFileDiff(Number(sessionId), filePath, repoId)
          : getLocalRepoFileDiff(localDiffParams));
        setDiffModalData(response || null);
      } catch (error) {
        console.error('Failed to load file diff:', error);
        setDiffModalData(null);
      } finally {
        setDiffModalLoading(false);
      }
    },
    [projectId, selectedRepo, sessionId]
  );

  const closeFileDiff = useCallback(() => {
    setDiffModalFile(null);
    setDiffModalData(null);
  }, []);

  const searchRepoFiles = useCallback(
    async (repo: AvailableProjectRepo, keyword: string) => {
      if (!repo.path) return;
      const repoKey = sourceKey(repo);
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
        const response = await searchProjectRepoTree({
          projectId,
          ...sourceParams(repo),
          sessionId,
          ref: showBranchSelector ? selectedBranchMap[repoKey] || repo.defaultBranch : undefined,
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
    [fetchRepoFiles, projectId, selectedBranchMap, sessionId, showBranchSelector]
  );

  const loadBranches = useCallback(
    async (repo: AvailableProjectRepo) => {
      const key = sourceKey(repo);
      if (repoBranchesMap[key]) return;
      const branches = await listProjectRepoBranches({ projectId, ...sourceParams(repo) }).catch(() => []);
      setRepoBranchesMap((current) => ({ ...current, [key]: branches }));
      if (!selectedBranchMap[key] && (repo.defaultBranch || branches[0]?.name)) {
        setSelectedBranchMap((current) => ({ ...current, [key]: repo.defaultBranch || branches[0].name }));
      }
    },
    [projectId, repoBranchesMap, selectedBranchMap]
  );

  // 只切换查看 ref：更新 selectedBranchMap 后重新 ls-tree，绝不 checkout，本地仓库工作区保持原状。
  const switchBranch = useCallback(
    async (repo: AvailableProjectRepo, branch: string) => {
      const key = sourceKey(repo);
      setSelectedBranchMap((current) => ({ ...current, [key]: branch }));
      setChildrenByPath({});
      setExpandedKeys([]);
      setRepoFilesMap((current) => ({ ...current, [key]: [] }));
      await fetchRepoFiles(repo, ensureDirectoryPath(repo.path), branch);
    },
    [fetchRepoFiles]
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
    async (key: string) => {
      const repo = repos.find((item) => sourceKey(item) === key);
      if (!repo || key === selectedSourceKey) return;
      setSelectedSourceKey(key);
      setChildrenByPath({});
      setExpandedKeys([]);
      setDiffModalFile(null);
      setDiffModalData(null);
      setTaskChanges(null);
      if (!repoFilesMap[key] && repo.path) {
        await fetchRepoFiles(repo, ensureDirectoryPath(repo.path));
      }
    },
    [fetchRepoFiles, repoFilesMap, repos, selectedSourceKey]
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
  const repoKey = sourceKey(repo);
  const currentPath = ensureDirectoryPath(repo.path);
  const showChangesView = !!repoChangesViewMap[repoKey];
  const taskChangeCount = taskChanges?.files?.length || 0;
  const loading = showChangesView ? taskChangesLoading : !!repoLoadingMap[repoKey];
  const repoMenuItems: MenuProps['items'] = repos.map((item) => ({
    key: sourceKey(item),
    label: item.repoFullName,
  }));
  const selectedBranch = selectedBranchMap[repoKey] || repo.defaultBranch || '';
  const branchMenuItems: MenuProps['items'] = (repoBranchesMap[repoKey] || []).map((branch) => ({
    key: branch.name,
    label: (
      <span className={styles.repoBranchMenuItem}>
        <span>{branch.name}</span>
        {branch.name === selectedBranch ? <span className={styles.repoBranchCurrent}>当前</span> : null}
      </span>
    ),
    onClick: () => void switchBranch(repo, branch.name),
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
            {!showBranchSelector && branchBadge}
            {repos.length > 1 ? (
              <Dropdown
                menu={{ items: repoMenuItems, onClick: ({ key }) => void switchRepository(key) }}
                trigger={['click']}
              >
                <button
                  type="button"
                  className={styles.repoSelector}
                  aria-label={repo.repoFullName}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                >
                  <DownOutlined />
                </button>
              </Dropdown>
            ) : null}
            {showBranchSelector ? (
              <Dropdown
                menu={{ items: branchMenuItems }}
                trigger={['click']}
                onOpenChange={(open) => open && void loadBranches(repo)}
              >
                <button
                  type="button"
                  className={styles.repoBranchSelector}
                  aria-label={selectedBranch || 'branch'}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                >
                  <BranchesOutlined />
                  <span className={styles.repoBranchName}>{selectedBranch || 'branch'}</span>
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
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
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
