import React, { useCallback, useEffect, useRef, useState, type Key } from 'react';
import { Dropdown, Empty, message } from 'antd';
import { BranchesOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import { DragType } from '@/components/QueryInput/withDrag';
import useGlobal from '@/hooks/useGlobal';
import FileSpaceBlock from '@/layout/sider/components/FileSiderPanel/components/FileSpaceBlock';
import type { FileTreeItem } from '@/layout/sider/components/FileSiderPanel/constants';
import {
  ensureDirectoryPath,
  isDirectory,
  normalizeFileBrowserPath,
  normalizeReferenceItem,
} from '@/layout/sider/components/FileSiderPanel/utils';
import {
  getProjectRepoFileContent,
  listProjectRepoBranches,
  listProjectRepoTree,
  listProjectRepos,
  type DevloopProjectRepo,
  type ProjectRepoBranch,
  type ProjectRepoTreeNode,
} from '@/service/devloop';
import type { DetailPanelOptions } from '@/layout/sider/siderContentContext';
import styles from '../index.module.less';

interface ReposTabProps {
  projectId: number;
  resourceId?: string | number;
  onOpenDetail?: (panel: React.ReactNode, options: DetailPanelOptions) => void;
}

const toFileBrowserItem = (node: ProjectRepoTreeNode) => ({
  name: node.name,
  path: node.path,
  isDir: node.type === 'directory',
  size: node.size,
});

const RemoteFileContent: React.FC<{ name: string; content: string; binary?: boolean }> = ({
  name,
  content,
  binary,
}) => (
  <div style={{ height: '100%', overflow: 'auto', padding: 16 }}>
    <div style={{ marginBottom: 8, color: '#667085', fontSize: 12 }}>{binary ? `${name} (Base64)` : name}</div>
    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{content}</pre>
  </div>
);

const ReposTab: React.FC<ReposTabProps> = ({ projectId, resourceId, onOpenDetail }) => {
  const intl = useIntl();
  const { EventEmitter } = useGlobal();
  const [repos, setRepos] = useState<DevloopProjectRepo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [repoFilesMap, setRepoFilesMap] = useState<Record<string, ReturnType<typeof toFileBrowserItem>[]>>({});
  const [repoLoadingMap, setRepoLoadingMap] = useState<Record<string, boolean>>({});
  const [childrenByRepoPath, setChildrenByRepoPath] = useState<
    Record<string, Record<string, ReturnType<typeof toFileBrowserItem>[]>>
  >({});
  const [expandedKeysMap, setExpandedKeysMap] = useState<Record<string, Key[]>>({});
  const [branchesMap, setBranchesMap] = useState<Record<string, ProjectRepoBranch[]>>({});
  const [branchMap, setBranchMap] = useState<Record<string, string>>({});
  const [branchLoadingMap, setBranchLoadingMap] = useState<Record<string, boolean>>({});
  const requestSeqRef = useRef<Record<string, number>>({});

  const fetchRepoTree = useCallback(
    async (repo: DevloopProjectRepo, branch?: string) => {
      const repoKey = `${repo.repoId}`;
      const selectedBranch = branch || repo.defaultBranch || 'main';
      const requestSeq = (requestSeqRef.current[repoKey] || 0) + 1;
      requestSeqRef.current[repoKey] = requestSeq;
      setRepoLoadingMap((current) => ({ ...current, [repoKey]: true }));
      try {
        const response = await listProjectRepoTree({
          projectId,
          repoId: repo.repoId,
          ref: selectedBranch,
        });
        if (requestSeq === requestSeqRef.current[repoKey]) {
          setRepoFilesMap((current) => ({ ...current, [repoKey]: (response || []).map(toFileBrowserItem) }));
        }
      } catch (error) {
        console.error('Failed to load remote repository tree:', error);
        if (requestSeq === requestSeqRef.current[repoKey]) {
          setRepoFilesMap((current) => ({ ...current, [repoKey]: [] }));
        }
      } finally {
        if (requestSeq === requestSeqRef.current[repoKey]) {
          setRepoLoadingMap((current) => ({ ...current, [repoKey]: false }));
        }
      }
    },
    [projectId]
  );

  const fetchBranches = useCallback(async (repo: DevloopProjectRepo) => {
    const repoKey = `${repo.repoId}`;
    setBranchLoadingMap((current) => ({ ...current, [repoKey]: true }));
    try {
      const branches = await listProjectRepoBranches(repo.repoId);
      const defaultBranch = repo.defaultBranch || branches?.[0]?.name || 'main';
      setBranchesMap((current) => ({ ...current, [repoKey]: branches || [] }));
      setBranchMap((current) => ({ ...current, [repoKey]: current[repoKey] || defaultBranch }));
    } catch (error) {
      console.error('Failed to load remote repository branches:', error);
      setBranchesMap((current) => ({ ...current, [repoKey]: [] }));
      setBranchMap((current) => ({ ...current, [repoKey]: current[repoKey] || repo.defaultBranch || 'main' }));
    } finally {
      setBranchLoadingMap((current) => ({ ...current, [repoKey]: false }));
    }
  }, []);

  const fetchRepos = useCallback(async () => {
    if (!projectId) return;
    setReposLoading(true);
    try {
      const nextRepos = (await listProjectRepos(projectId)) || [];
      setRepos(nextRepos);
      await Promise.all(nextRepos.map((repo) => fetchBranches(repo)));
      await Promise.all(nextRepos.map((repo) => fetchRepoTree(repo)));
    } catch (error) {
      console.error('Failed to load project repositories:', error);
      setRepos([]);
    } finally {
      setReposLoading(false);
    }
  }, [fetchBranches, fetchRepoTree, projectId]);

  useEffect(() => {
    setRepos([]);
    setRepoFilesMap({});
    setChildrenByRepoPath({});
    setExpandedKeysMap({});
    setBranchesMap({});
    setBranchMap({});
    void fetchRepos();
  }, [fetchRepos]);

  const loadRepoTreeNode = useCallback(
    async (repo: DevloopProjectRepo, node: FileTreeItem) => {
      if (!isDirectory(node)) return;
      const repoKey = `${repo.repoId}`;
      const path = ensureDirectoryPath(normalizeFileBrowserPath(node.path));
      if (childrenByRepoPath[repoKey]?.[path]) return;
      try {
        const response = await listProjectRepoTree({
          projectId,
          repoId: repo.repoId,
          path,
          ref: branchMap[repoKey] || repo.defaultBranch || 'main',
        });
        setChildrenByRepoPath((current) => ({
          ...current,
          [repoKey]: { ...(current[repoKey] || {}), [path]: (response || []).map(toFileBrowserItem) },
        }));
      } catch (error) {
        console.error('Failed to load remote repository directory:', error);
        setChildrenByRepoPath((current) => ({
          ...current,
          [repoKey]: { ...(current[repoKey] || {}), [path]: [] },
        }));
      }
    },
    [branchMap, childrenByRepoPath, projectId]
  );

  const handleNodeClick = useCallback(
    async (repo: DevloopProjectRepo, event: React.MouseEvent, node: FileTreeItem) => {
      event.stopPropagation();
      if (isDirectory(node) || !onOpenDetail) return;
      const branch = branchMap[`${repo.repoId}`] || repo.defaultBranch || 'main';
      try {
        const file = await getProjectRepoFileContent({ repoId: repo.repoId, branch, path: node.path });
        const content = file.binary ? file.base64Content || '' : file.content || '';
        onOpenDetail(<RemoteFileContent name={file.path || node.name} content={content} binary={file.binary} />, {
          tabKey: `repo-remote-file:${repo.repoId}:${branch}:${node.path}`,
          title: node.name,
        });
      } catch (error: any) {
        message.error(error?.message || '文件内容加载失败');
      }
    },
    [branchMap, onOpenDetail]
  );

  const quoteFile = useCallback(
    (node: FileTreeItem) => {
      if (!resourceId) return;
      EventEmitter.emit('queryInput-insert-item', {
        item: normalizeReferenceItem(node, `${resourceId}`),
        type: isDirectory(node) ? DragType.commonFolder : DragType.commonFile,
      });
    },
    [EventEmitter, resourceId]
  );

  const refreshRepo = useCallback(
    async (repo: DevloopProjectRepo) => {
      const repoKey = `${repo.repoId}`;
      setChildrenByRepoPath((current) => ({ ...current, [repoKey]: {} }));
      setExpandedKeysMap((current) => ({ ...current, [repoKey]: [] }));
      await fetchRepoTree(repo, branchMap[repoKey] || repo.defaultBranch || 'main');
    },
    [branchMap, fetchRepoTree]
  );

  const changeBranch = useCallback(
    async (repo: DevloopProjectRepo, branch: string) => {
      const repoKey = `${repo.repoId}`;
      setBranchMap((current) => ({ ...current, [repoKey]: branch }));
      setChildrenByRepoPath((current) => ({ ...current, [repoKey]: {} }));
      setExpandedKeysMap((current) => ({ ...current, [repoKey]: [] }));
      await fetchRepoTree(repo, branch);
    },
    [fetchRepoTree]
  );

  if (!repos.length) {
    return (
      <div className={styles.detailResourcePanel}>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={intl.formatMessage({
            id: reposLoading ? 'projectSpace.detail.repo.loading' : 'projectSpace.detail.repo.emptyRepositories',
          })}
        />
      </div>
    );
  }

  const fillContainer = repos.length <= 1;
  return (
    <div className={styles.detailResourcePanel} style={fillContainer ? undefined : { padding: 10 }}>
      {repos.map((repo, idx) => {
        const repoKey = `${repo.repoId}`;
        const branch = branchMap[repoKey] || repo.defaultBranch || 'main';
        const branches = branchesMap[repoKey] || [];
        const branchItems = branches.map((item) => ({
          key: item.name,
          label: item.name,
          onClick: () => void changeBranch(repo, item.name),
        }));
        return (
          <FileSpaceBlock
            key={repoKey}
            title={repo.repoFullName}
            fillContainer={fillContainer}
            style={idx > 0 ? { marginTop: 10 } : undefined}
            headerExtra={
              <Dropdown menu={{ items: branchItems }} trigger={['click']}>
                <button type="button" className={styles.repoChangesButton} disabled={!!branchLoadingMap[repoKey]}>
                  <BranchesOutlined />
                  <span>{branch}</span>
                </button>
              </Dropdown>
            }
            loading={!!repoLoadingMap[repoKey]}
            items={repoFilesMap[repoKey] || []}
            currentPath="/"
            emptyText={intl.formatMessage({ id: 'projectSpace.detail.repo.emptyFiles' })}
            resourceEmptyStyle
            childrenByPath={childrenByRepoPath[repoKey] || {}}
            expandedKeys={expandedKeysMap[repoKey] || []}
            onRefresh={() => void refreshRepo(repo)}
            onExpand={(keys) => setExpandedKeysMap((current) => ({ ...current, [repoKey]: keys }))}
            onLoadData={(node) => loadRepoTreeNode(repo, node)}
            onNodeClick={(event, node) => handleNodeClick(repo, event, node)}
            onNodeDoubleClick={quoteFile}
          />
        );
      })}
    </div>
  );
};

export default ReposTab;
