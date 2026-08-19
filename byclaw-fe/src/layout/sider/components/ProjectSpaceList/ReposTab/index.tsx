import React, { useCallback, useEffect, useRef, useState, type Key } from 'react';
import { Button, Dropdown, Empty, Input, message } from 'antd';
import { BranchesOutlined, DownOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import FilePreviewPanel from '@/components/ChatLayoutComp/ChatResourceWorkspace/FilePreviewPanel';
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
  searchProjectRepoTree,
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
  // FileTreeList 使用 path 作为目录缓存键；统一补齐根斜杠，保证根节点与懒加载子节点使用同一套键格式。
  path: normalizeFileBrowserPath(node.path),
  isDir: node.type === 'directory',
  size: node.size,
});

const formatBranchLabel = (branch: string) => (branch.length > 10 ? `${branch.substring(0, 10)}...` : branch);

// 远程仓库文件只有字符串/base64，没有可下载的 resourceId+path，走 FilePreviewPanel 的 content 入口复用富预览。
const RemoteFileContent: React.FC<{ name: string; content: string | null; binary?: boolean }> = ({
  name,
  content,
  binary,
}) => (
  <div style={{ height: '100%', overflow: 'hidden' }}>
    <FilePreviewPanel fileName={name} content={{ data: content, binary }} />
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
  const [repoSearchValueMap, setRepoSearchValueMap] = useState<Record<string, string>>({});
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
    setRepoSearchValueMap({});
    void fetchRepos();
  }, [fetchRepos]);

  const searchRepoFiles = useCallback(
    async (repo: DevloopProjectRepo, keyword: string, branch?: string) => {
      const repoKey = `${repo.repoId}`;
      const selectedBranch = branch || branchMap[repoKey] || repo.defaultBranch || 'main';
      const normalizedKeyword = keyword.trim();
      if (!normalizedKeyword) {
        await fetchRepoTree(repo, selectedBranch);
        return;
      }
      const requestSeq = (requestSeqRef.current[repoKey] || 0) + 1;
      requestSeqRef.current[repoKey] = requestSeq;
      setRepoLoadingMap((current) => ({ ...current, [repoKey]: true }));
      try {
        const response = await searchProjectRepoTree({
          projectId,
          repoId: repo.repoId,
          keyword: normalizedKeyword,
          ref: selectedBranch,
        });
        if (requestSeq === requestSeqRef.current[repoKey]) {
          setRepoFilesMap((current) => ({ ...current, [repoKey]: (response || []).map(toFileBrowserItem) }));
          setChildrenByRepoPath((current) => ({ ...current, [repoKey]: {} }));
          setExpandedKeysMap((current) => ({ ...current, [repoKey]: [] }));
        }
      } catch (error) {
        console.error('Failed to search remote repository files:', error);
        if (requestSeq === requestSeqRef.current[repoKey]) {
          setRepoFilesMap((current) => ({ ...current, [repoKey]: [] }));
        }
      } finally {
        if (requestSeq === requestSeqRef.current[repoKey]) {
          setRepoLoadingMap((current) => ({ ...current, [repoKey]: false }));
        }
      }
    },
    [branchMap, fetchRepoTree, projectId]
  );

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
      const tabKey = `repo-remote-file:${repo.repoId}:${branch}:${node.path}`;
      // 点击立即打开 detail panel 显示 loading，后台拉取完再刷新同一个 tab 填入真内容。
      onOpenDetail(<RemoteFileContent name={node.name} content={null} binary={undefined} />, {
        tabKey,
        title: node.name,
      });
      try {
        const file = await getProjectRepoFileContent({ repoId: repo.repoId, branch, path: node.path });
        const content = file.binary ? file.base64Content || '' : file.content || '';
        onOpenDetail(<RemoteFileContent name={node.name} content={content} binary={file.binary} />, {
          tabKey,
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
      const keyword = repoSearchValueMap[repoKey] || '';
      await searchRepoFiles(repo, keyword, branchMap[repoKey] || repo.defaultBranch || 'main');
    },
    [branchMap, repoSearchValueMap, searchRepoFiles]
  );

  const changeBranch = useCallback(
    async (repo: DevloopProjectRepo, branch: string) => {
      const repoKey = `${repo.repoId}`;
      setBranchMap((current) => ({ ...current, [repoKey]: branch }));
      setChildrenByRepoPath((current) => ({ ...current, [repoKey]: {} }));
      setExpandedKeysMap((current) => ({ ...current, [repoKey]: [] }));
      await searchRepoFiles(repo, repoSearchValueMap[repoKey] || '', branch);
    },
    [repoSearchValueMap, searchRepoFiles]
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
              <Dropdown menu={{ items: branchItems }} trigger={['click']} overlayClassName={styles.repoBranchDropdown}>
                <Button
                  type="text"
                  loading={!!branchLoadingMap[repoKey]}
                  icon={<DownOutlined />}
                  iconPosition="end"
                  title={branch}
                  style={{ paddingInline: 5 }}
                >
                  <BranchesOutlined />
                  <span>{formatBranchLabel(branch)}</span>
                </Button>
              </Dropdown>
            }
            contentBefore={
              <div className={styles.detailRepoSearch}>
                <Input.Search
                  allowClear
                  value={repoSearchValueMap[repoKey] || ''}
                  placeholder={intl.formatMessage({ id: 'projectSpace.detail.repo.searchPlaceholder' })}
                  loading={!!repoLoadingMap[repoKey]}
                  onChange={(event) =>
                    setRepoSearchValueMap((current) => ({ ...current, [repoKey]: event.target.value }))
                  }
                  onSearch={(value) => void searchRepoFiles(repo, value, branch)}
                  onClear={() => void searchRepoFiles(repo, '', branch)}
                />
              </div>
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
