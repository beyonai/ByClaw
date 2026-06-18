import React, { useState, useRef, useEffect, useCallback, useContext, useMemo } from 'react';
import { Input, Breadcrumb, Tree, Spin, App, ConfigProvider, Dropdown, Modal, Space, Typography, List } from 'antd';
import { EllipsisOutlined, LeftOutlined } from '@ant-design/icons';
import classnames from 'classnames';
import { AntdTreeNodeAttribute, EventDataNode } from 'antd/es/tree';
import AntdIcon from '@/components/AntdIcon';
import { useIntl, useSelector } from '@umijs/max';
import useVirtualHeight from '@/hooks/useVirtualHeight';
import useGlobal from '@/hooks/useGlobal';
import { downloadResourceFile } from '@/service/file';
import {
  createFolder as createFileBrowserFolder,
  ensureFolder as ensureFileBrowserFolder,
  listFiles as listFileBrowserFiles,
  uploadFiles as uploadFileBrowserFiles,
} from '@/service/fileBrowser';
import type { FileBrowserItem } from '@/service/fileBrowser';
import { resolveTreeItemDirectoryPath } from './service';
import { HALF_MAIN_CONTENT_DETAIL_PANEL_WIDTH, SiderContentContext } from '@/layout/sider/siderContentContext';
import type { QueryDirAndFileByLevelItem } from '@/service/knowledgeCenter';
import { downloadFile } from '@/utils/file';
import { getFileIconType } from '@/constants/icon';
import {
  getMimeType,
  isPreviewable,
} from '@/components/QueryInput/components/FileBrowserEntry/components/FileBrowserPanel/constants';
import useShowModal from '@/hooks/useShowModal';
import RenameModal from '@/pages/knowledgeDetail/components/RenameModal';
import { IDragType, DragType, onTreeNodeDragStart } from '@/components/QueryInput/withDrag';
import { IKnowledgeBaseItem, IKnowledgeCollectionItem, IKnowledgeDetailTreeItem } from './types';
import { delFolderOrFile, qryFolderAndFileList, searchFolderAndFileList } from './service';
import { deleteTreeNode, updateTreeNode } from './utils';
import commonStyles from '../common.module.less';
import styles from './index.module.less';
import { TreeProps } from 'antd/lib';

const PreViewFile = React.lazy(() =>
  import('@/components/Preview/Twins').then((module) => ({ default: module.PreViewFile }))
);

const SHARED_FILES_PATH = '/.shared/';

type FileCopyTargetType = 'session' | 'shared';

function getSessionFilesPath(sessionId?: string) {
  const normalizedSessionId = String(sessionId || '').trim();
  return normalizedSessionId ? `/.sessions/${normalizedSessionId}/` : '/.sessions/';
}

function ensureDirectoryPath(path: string) {
  return path.endsWith('/') ? path : `${path}/`;
}

function normalizeKnowledgePath(path?: string) {
  const normalizedPath = `${path || '/'}`.trim().replace(/\\/g, '/').replace(/\/+/g, '/');
  if (!normalizedPath || normalizedPath === '/') {
    return '/';
  }
  return normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`;
}

function joinFileBrowserDirectoryPath(parentPath: string, name: string) {
  return `${ensureDirectoryPath(parentPath)}${name}/`.replace(/\/+/g, '/');
}

function buildTargetFolderPath(parentPath: string, folderName: string) {
  return `${ensureDirectoryPath(parentPath)}${folderName}/`.replace(/\/+/g, '/');
}

function buildScopedFolderPath(currentPath: string, rootPath: string) {
  const scopedRoot = ensureDirectoryPath(normalizeKnowledgePath(rootPath));
  const scopedCurrent = ensureDirectoryPath(normalizeKnowledgePath(currentPath));
  const paths = scopedRoot
    .split('/')
    .filter(Boolean)
    .map((segment, index, segments) => ({
      title: segment,
      id: `/${segments.slice(0, index + 1).join('/')}/`,
    }));
  if (!scopedCurrent.startsWith(scopedRoot) || scopedCurrent === scopedRoot) {
    return paths;
  }
  let accumulated = scopedRoot;
  const restSegments = scopedCurrent.slice(scopedRoot.length).split('/').filter(Boolean);
  for (const segment of restSegments) {
    accumulated += `${segment}/`;
    paths.push({ title: segment, id: accumulated });
  }
  return paths;
}

function getKnowledgeItemName(item: Pick<IKnowledgeDetailTreeItem, 'title' | 'collectionName'>) {
  return String(item.title || item.collectionName || '');
}

function getRawBlob(res: any) {
  return res?.file instanceof Blob ? res.file : res instanceof Blob ? res : new Blob([res?.file || res]);
}

function unwrapListResponse<T>(res: any): T[] {
  const data = res?.data ?? res ?? [];
  return Array.isArray(data) ? data : [];
}

function isFileBrowserDirectory(item: any) {
  return item?.isDir || item?.dir;
}

function toKnowledgeTreeItem(
  item: QueryDirAndFileByLevelItem,
  parentId: string,
  datasetId: string
): IKnowledgeDetailTreeItem {
  const directoryPath = String(item.directoryPath ?? '').trim();
  const pathKey =
    directoryPath || String(item.id !== null && item.id !== undefined ? item.id : `${parentId}/${item.name}`);

  return {
    id: String(item.id ?? ''),
    collectionName: item.name,
    datasetId,
    type: item.type,
    fileId: item.fileId !== null && item.fileId !== undefined ? String(item.fileId) : undefined,
    parentId,
    directoryPath: item.directoryPath,
    title: item.name,
    key: pathKey,
    isLeaf: item.type === 'file',
  };
}

function mergeKnowledgeTreeChildren(
  existingChildren: IKnowledgeDetailTreeItem[] = [],
  nextChildren: IKnowledgeDetailTreeItem[]
) {
  const childMap = new Map<React.Key, IKnowledgeDetailTreeItem>();
  nextChildren.forEach((child) => childMap.set(child.key, child));
  existingChildren.forEach((child) => {
    const nextChild = childMap.get(child.key);
    childMap.set(child.key, {
      ...(nextChild || child),
      ...child,
      children: child.children || nextChild?.children,
    });
  });
  return Array.from(childMap.values());
}

function mergeTreeNodeChildren(
  list: IKnowledgeDetailTreeItem[],
  key: React.Key,
  children: IKnowledgeDetailTreeItem[]
): IKnowledgeDetailTreeItem[] {
  return list.map((node) => {
    if (node.key === key) {
      return {
        ...node,
        children: mergeKnowledgeTreeChildren(node.children, children),
      };
    }
    if (node.children) {
      return {
        ...node,
        children: mergeTreeNodeChildren(node.children, key, children),
      };
    }
    return node;
  });
}

function buildKnowledgeSearchTree(items: QueryDirAndFileByLevelItem[], datasetId: string) {
  const roots: IKnowledgeDetailTreeItem[] = [];
  const nodeMap = new Map<string, IKnowledgeDetailTreeItem>();

  items.forEach((item) => {
    const rawPath = normalizeKnowledgePath(item.directoryPath || item.name);
    const normalizedPath = item.type === 'directory' ? ensureDirectoryPath(rawPath) : rawPath;
    const segments = normalizedPath.split('/').filter(Boolean);
    if (!segments.length) return;

    let parentId = '-1';
    let accumulatedPath = '/';
    let siblings = roots;

    segments.forEach((segment, index) => {
      const isLast = index === segments.length - 1;
      const isDirectoryNode = !isLast || item.type === 'directory';
      const nodePath = isDirectoryNode ? `${accumulatedPath}${segment}/` : `${accumulatedPath}${segment}`;
      let node = nodeMap.get(nodePath);

      if (!node) {
        node = {
          id: isLast ? String(item.id ?? '') : nodePath,
          collectionName: isLast ? item.name : segment,
          datasetId,
          type: isDirectoryNode ? 'directory' : 'file',
          fileId: isLast && item.fileId !== null && item.fileId !== undefined ? String(item.fileId) : undefined,
          parentId,
          directoryPath: nodePath,
          title: isLast ? item.name : segment,
          key: nodePath,
          isLeaf: !isDirectoryNode,
        };
        siblings.push(node);
        nodeMap.set(nodePath, node);
      } else if (isLast) {
        Object.assign(node, {
          id: String(item.id ?? node.id ?? ''),
          collectionName: item.name,
          fileId: item.fileId !== null && item.fileId !== undefined ? String(item.fileId) : node.fileId,
          directoryPath: normalizedPath,
          title: item.name,
          isLeaf: item.type === 'file',
          type: item.type,
        });
      }

      if (isDirectoryNode) {
        if (!node.children && !isLast) {
          node.children = [];
        }
        siblings = node.children || [];
        parentId = nodePath;
        accumulatedPath = nodePath;
      }
    });
  });

  return roots;
}

interface KnowledgeBaseDetailProps {
  editable?: boolean;
  dataset: IKnowledgeBaseItem;
  onGoBack: () => void;
  onSelect?: (item: IKnowledgeCollectionItem, type: IDragType) => void;
  activeAgentResourceId?: string;
}

function onDragStart(info: Parameters<Required<TreeProps>['onDragStart']>[0]) {
  const data = info.node as unknown as IKnowledgeDetailTreeItem;
  onTreeNodeDragStart(info.event, data, data.type === 'file' ? DragType.file : DragType.folder);
}

function getNodeIcon(p: AntdTreeNodeAttribute) {
  const { isLeaf, title } = p;
  const data = p as unknown as Partial<IKnowledgeDetailTreeItem>;
  const iconType = getFileIconType(title as string, {
    isDirectory: data.type === 'directory' || !isLeaf,
    directoryIconType: 'wenjianjialanse',
  });

  return <AntdIcon type={`icon-${iconType}`} />;
}

function getFileType(name: string): string {
  const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() || '' : '';
  if (ext === 'jpeg') return 'jpg';
  if (['html', 'htm'].includes(ext)) return 'h5';
  return ext;
}

interface FilePreviewPanelProps {
  blob: Blob | null;
  fileName: string;
  fileType: string;
  loading: boolean;
  onClose: () => void;
}

const FilePreviewPanel: React.FC<FilePreviewPanelProps> = ({ blob, fileName, fileType, loading, onClose }) => (
  <div className={styles.previewPanel}>
    <div className={styles.previewHeader}>
      <span className={styles.previewTitle}>{fileName}</span>
      <span className={styles.previewClose} onClick={onClose}>
        <AntdIcon type="icon-a-Closeguanbi1" />
      </span>
    </div>
    <div className={styles.previewBody}>
      <Spin spinning={loading} wrapperClassName={styles.previewSpin}>
        {blob && (
          <React.Suspense fallback={null}>
            <PreViewFile data={blob} type={fileType} title={fileName} className={styles.previewContent} />
          </React.Suspense>
        )}
      </Spin>
    </div>
  </div>
);

const KnowledgeBaseDetail = (props: KnowledgeBaseDetailProps) => {
  const { editable, dataset, onGoBack, onSelect, activeAgentResourceId } = props;
  const [searchValue, setSearchValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [treeData, setTreeData] = useState<IKnowledgeDetailTreeItem[]>([]);
  const [searchHydratedKeys, setSearchHydratedKeys] = useState<Set<React.Key>>(new Set());
  const treeWrap = useRef<HTMLDivElement>(null);
  const treeClickTimerRef = useRef<number | null>(null);
  const virtualHeight = useVirtualHeight(treeWrap);
  const { EventEmitter, sessionId } = useGlobal();
  const { userInfo } = useSelector(({ user }: any) => ({
    userInfo: user.userInfo,
  }));

  const intl = useIntl();
  const { modal, message } = App.useApp();
  const [modalState, modalAction] = useShowModal();
  const { setDetailPanel, clearDetailPanel } = useContext(SiderContentContext);
  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const [copyTarget, setCopyTarget] = useState<IKnowledgeDetailTreeItem | null>(null);
  const [copyTargetType, setCopyTargetType] = useState<FileCopyTargetType>('session');
  const [copyDirectoryPath, setCopyDirectoryPath] = useState('/');
  const [copyFolders, setCopyFolders] = useState<FileBrowserItem[]>([]);
  const [copyFolderLoading, setCopyFolderLoading] = useState(false);
  const [copyingToFileBrowser, setCopyingToFileBrowser] = useState(false);

  const copyFolderPath = useMemo(() => {
    const rootPath = copyTargetType === 'session' ? '/.sessions/' : SHARED_FILES_PATH;
    return buildScopedFolderPath(copyDirectoryPath, rootPath);
  }, [copyDirectoryPath, copyTargetType]);

  const qryFlatternList = async (parentId: string, options?: { rootLoading?: boolean }) => {
    if (parentId === '-1') {
      if (options?.rootLoading !== false) {
        setLoading(true);
      }
      setTreeData([]);
    }
    let result: IKnowledgeDetailTreeItem[] = [];
    try {
      const resourceId = Number(dataset.resourceId);
      const directoryPath = parentId === '-1' ? '/' : String(parentId);
      const response = await qryFolderAndFileList({
        resourceId,
        directoryPath,
      });
      const datasetId = String(dataset.resourceSourcePkId ?? dataset.resourceId ?? '');
      result = (response || []).map((item: QueryDirAndFileByLevelItem) => {
        return toKnowledgeTreeItem(item, String(parentId), datasetId);
      }) as IKnowledgeDetailTreeItem[];
      if (parentId === '-1') {
        setTreeData(result);
      }
    } catch (error) {
      console.log(error);
    } finally {
      setLoading(false);
    }
    return result;
  };

  useEffect(() => {
    const keyword = searchValue.trim();
    setSearchHydratedKeys(new Set());
    if (!keyword) {
      qryFlatternList('-1');
      return;
    }

    const searchTree = async () => {
      setLoading(true);
      setTreeData([]);
      try {
        const response = await searchFolderAndFileList({
          resourceId: Number(dataset.resourceId),
          directoryPath: '/',
          keyword,
        });
        const datasetId = String(dataset.resourceSourcePkId ?? dataset.resourceId ?? '');
        setTreeData(buildKnowledgeSearchTree(response || [], datasetId));
      } catch (error) {
        console.log(error);
      } finally {
        setLoading(false);
      }
    };
    searchTree();
  }, [searchValue]);

  const clearTreeClickTimer = useCallback(() => {
    if (treeClickTimerRef.current !== null) {
      window.clearTimeout(treeClickTimerRef.current);
      treeClickTimerRef.current = null;
    }
  }, []);

  const getTreeNodeDragType = useCallback(
    (item: IKnowledgeDetailTreeItem): IDragType => (item.type === 'file' ? DragType.file : DragType.folder),
    []
  );

  const renderPreviewPanel = useCallback(
    (item: IKnowledgeDetailTreeItem, options: { blob?: Blob | null; loading: boolean }) => {
      setDetailPanel?.(
        <FilePreviewPanel
          blob={options.blob ?? null}
          fileName={String(item.title || item.collectionName || '')}
          fileType={getFileType(String(item.title || item.collectionName || ''))}
          loading={options.loading}
          onClose={() => clearDetailPanel?.()}
        />,
        { width: HALF_MAIN_CONTENT_DETAIL_PANEL_WIDTH }
      );
    },
    [clearDetailPanel, setDetailPanel]
  );

  const handlePreviewFile = useCallback(
    async (item: IKnowledgeDetailTreeItem) => {
      const fileName = getKnowledgeItemName(item);
      if (!isPreviewable(fileName)) return;

      const directoryPath = resolveTreeItemDirectoryPath(item);
      if (!directoryPath) {
        message.warning(intl.formatMessage({ id: 'directoryManage.resolveFilePathFailed' }));
        return;
      }

      renderPreviewPanel(item, { loading: true });
      try {
        const res: any = await downloadResourceFile({
          resourceId: dataset.resourceId,
          directoryPath,
        });
        const rawBlob = getRawBlob(res);
        const mimeType = getMimeType(fileName);
        const blob = mimeType ? new Blob([rawBlob], { type: mimeType }) : rawBlob;
        renderPreviewPanel(item, { blob, loading: false });
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.preview.failed' }));
        clearDetailPanel?.();
      }
    },
    [clearDetailPanel, dataset.resourceId, intl, message, renderPreviewPanel]
  );

  const copyKnowledgeFileToFileBrowser = useCallback(
    async (item: IKnowledgeDetailTreeItem, targetPath: string) => {
      const fileName = getKnowledgeItemName(item);
      const directoryPath = resolveTreeItemDirectoryPath(item);
      if (!activeAgentResourceId || !directoryPath || !fileName) {
        throw new Error(intl.formatMessage({ id: 'directoryManage.resolveFilePathFailed' }));
      }

      const res: any = await downloadResourceFile({
        resourceId: dataset.resourceId,
        directoryPath,
      });
      const rawBlob = getRawBlob(res);
      const mimeType = rawBlob.type || getMimeType(fileName) || undefined;
      const file = new File([rawBlob], fileName, mimeType ? { type: mimeType } : undefined);
      await uploadFileBrowserFiles(activeAgentResourceId, targetPath, [file]);
    },
    [activeAgentResourceId, dataset.resourceId, intl]
  );

  const ensureFileBrowserDirectory = useCallback(
    async (parentPath: string, folderName: string, targetDirectoryPath: string) => {
      if (!activeAgentResourceId) {
        throw new Error(intl.formatMessage({ id: 'fileBrowser.save.missingResource' }, { target: '' }));
      }

      try {
        await createFileBrowserFolder({ resourceId: activeAgentResourceId, path: targetDirectoryPath });
      } catch (error) {
        const response = await listFileBrowserFiles({ resourceId: activeAgentResourceId, path: parentPath });
        const siblings = unwrapListResponse<any>(response);
        const existed = siblings.some((item) => item?.name === folderName && isFileBrowserDirectory(item));
        if (!existed) {
          throw error;
        }
      }
    },
    [activeAgentResourceId, intl]
  );

  const ensureFileBrowserTargetDirectory = useCallback(
    async (targetPath: string) => {
      if (!activeAgentResourceId) {
        throw new Error(intl.formatMessage({ id: 'fileBrowser.save.missingResource' }, { target: '' }));
      }
      const normalizedTargetPath = ensureDirectoryPath(normalizeKnowledgePath(targetPath));
      if (normalizedTargetPath !== '/') {
        await ensureFileBrowserFolder({ resourceId: activeAgentResourceId, path: normalizedTargetPath });
      }
      return normalizedTargetPath;
    },
    [activeAgentResourceId, intl]
  );

  const loadCopyFolders = useCallback(
    async (targetPath: string) => {
      if (!activeAgentResourceId) {
        message.warning(intl.formatMessage({ id: 'fileBrowser.save.missingResource' }, { target: '' }));
        return;
      }

      const normalizedTargetPath = ensureDirectoryPath(normalizeKnowledgePath(targetPath));
      setCopyDirectoryPath(normalizedTargetPath);
      setCopyFolderLoading(true);
      try {
        await ensureFileBrowserTargetDirectory(normalizedTargetPath);
        const response = await listFileBrowserFiles({ resourceId: activeAgentResourceId, path: normalizedTargetPath });
        setCopyFolders(unwrapListResponse<FileBrowserItem>(response).filter(isFileBrowserDirectory));
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.error.loadFailed' }));
        setCopyFolders([]);
      } finally {
        setCopyFolderLoading(false);
      }
    },
    [activeAgentResourceId, ensureFileBrowserTargetDirectory, intl, message]
  );

  const copyKnowledgeDirectoryToFileBrowser = useCallback(
    async function copyDirectory(item: IKnowledgeDetailTreeItem, parentTargetPath: string): Promise<void> {
      const folderName = getKnowledgeItemName(item);
      const directoryPath = resolveTreeItemDirectoryPath(item);
      if (!activeAgentResourceId || !directoryPath || !folderName) {
        throw new Error(intl.formatMessage({ id: 'directoryManage.resolveFilePathFailed' }));
      }

      const targetDirectoryPath = joinFileBrowserDirectoryPath(parentTargetPath, folderName);
      await ensureFileBrowserDirectory(parentTargetPath, folderName, targetDirectoryPath);

      const response = await qryFolderAndFileList({
        resourceId: Number(dataset.resourceId),
        directoryPath,
      });
      const datasetId = String(dataset.resourceSourcePkId ?? dataset.resourceId ?? '');
      const children = unwrapListResponse<QueryDirAndFileByLevelItem>(response).map((child) =>
        toKnowledgeTreeItem(child, directoryPath, datasetId)
      );

      for (const child of children) {
        if (child.type === 'directory') {
          await copyDirectory(child, targetDirectoryPath);
        } else {
          await copyKnowledgeFileToFileBrowser(child, targetDirectoryPath);
        }
      }
    },
    [
      activeAgentResourceId,
      copyKnowledgeFileToFileBrowser,
      dataset.resourceId,
      dataset.resourceSourcePkId,
      ensureFileBrowserDirectory,
      intl,
    ]
  );

  const openSaveToFileBrowser = useCallback(
    (item: IKnowledgeDetailTreeItem, targetType: FileCopyTargetType) => {
      if (!activeAgentResourceId) {
        const targetName = intl.formatMessage({
          id: targetType === 'session' ? 'fileBrowser.save.target.sessionFiles' : 'fileBrowser.save.target.sharedFiles',
        });
        message.warning(intl.formatMessage({ id: 'fileBrowser.save.missingResource' }, { target: targetName }));
        return;
      }
      const defaultPath = targetType === 'session' ? getSessionFilesPath(sessionId) : SHARED_FILES_PATH;
      setCopyTarget(item);
      setCopyTargetType(targetType);
      setCopyDirectoryPath(defaultPath);
      setCopyFolders([]);
      setCopyModalOpen(true);
      void loadCopyFolders(defaultPath);
    },
    [activeAgentResourceId, intl, loadCopyFolders, message, sessionId]
  );

  const handleConfirmSaveToFileBrowser = useCallback(async () => {
    if (!copyTarget) return;

    const targetName = intl.formatMessage({
      id: copyTargetType === 'session' ? 'fileBrowser.save.target.sessionFiles' : 'fileBrowser.save.target.sharedFiles',
    });
    const messageKey = copyTargetType === 'session' ? 'saveToSessionFiles' : 'saveToSharedFiles';

    const saveToTargetPath = async (item: IKnowledgeDetailTreeItem, targetPath: string) => {
      if (!activeAgentResourceId) {
        message.warning(intl.formatMessage({ id: 'fileBrowser.save.missingResource' }, { target: targetName }));
        return;
      }

      const fileName = getKnowledgeItemName(item);
      const directoryPath = resolveTreeItemDirectoryPath(item);
      if (!directoryPath || !fileName) {
        message.warning(intl.formatMessage({ id: 'directoryManage.resolveFilePathFailed' }));
        return;
      }

      const normalizedTargetPath = await ensureFileBrowserTargetDirectory(targetPath);
      message.loading({
        content: intl.formatMessage({ id: 'fileBrowser.save.saving' }, { target: targetName }),
        key: messageKey,
        duration: 0,
      });
      try {
        if (item.type === 'directory') {
          await copyKnowledgeDirectoryToFileBrowser(item, normalizedTargetPath);
        } else {
          await copyKnowledgeFileToFileBrowser(item, normalizedTargetPath);
        }
        message.destroy(messageKey);
        message.success(intl.formatMessage({ id: 'fileBrowser.save.success' }, { target: targetName }));
        setCopyModalOpen(false);
        setCopyTarget(null);
      } catch (error: any) {
        message.destroy(messageKey);
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.save.failed' }, { target: targetName }));
      }
    };

    setCopyingToFileBrowser(true);
    try {
      await saveToTargetPath(copyTarget, copyDirectoryPath);
    } finally {
      setCopyingToFileBrowser(false);
    }
  }, [
    activeAgentResourceId,
    copyDirectoryPath,
    copyKnowledgeDirectoryToFileBrowser,
    copyKnowledgeFileToFileBrowser,
    copyTarget,
    copyTargetType,
    ensureFileBrowserTargetDirectory,
    intl,
    message,
  ]);

  const handleTreeNodeClick = useCallback(
    (event: React.MouseEvent, node: EventDataNode<IKnowledgeDetailTreeItem>) => {
      event.stopPropagation();
      clearTreeClickTimer();
      treeClickTimerRef.current = window.setTimeout(() => {
        treeClickTimerRef.current = null;
        if (node.type === 'file') {
          void handlePreviewFile(node);
          return;
        }
        onSelect?.(node, getTreeNodeDragType(node));
      }, 220);
    },
    [clearTreeClickTimer, getTreeNodeDragType, handlePreviewFile, onSelect]
  );

  const handleTreeNodeDoubleClick = useCallback(
    (event: React.MouseEvent, node: EventDataNode<IKnowledgeDetailTreeItem>) => {
      event.stopPropagation();
      clearTreeClickTimer();
      EventEmitter.emit('queryInput-insert-item', {
        item: node,
        type: getTreeNodeDragType(node),
      });
    },
    [EventEmitter, clearTreeClickTimer, getTreeNodeDragType]
  );

  useEffect(() => {
    return clearTreeClickTimer;
  }, [clearTreeClickTimer]);

  const expandFolder = ({ key, children }: EventDataNode<IKnowledgeDetailTreeItem>) =>
    new Promise<void>((resolve) => {
      if (children) {
        resolve();
        return;
      }
      qryFlatternList(key).then((result) => {
        setTreeData((origin) => updateTreeNode(origin, key, { children: result }));
        resolve();
      });
    });

  const hydrateSearchDirectoryChildren = useCallback(
    async (node: EventDataNode<IKnowledgeDetailTreeItem>) => {
      const keyword = searchValue.trim();
      if (!keyword || node.type === 'file' || searchHydratedKeys.has(node.key)) {
        return;
      }
      setSearchHydratedKeys((prev) => {
        const next = new Set(prev);
        next.add(node.key);
        return next;
      });
      const children = await qryFlatternList(String(node.key), { rootLoading: false });
      setTreeData((origin) => mergeTreeNodeChildren(origin, node.key, children));
    },
    [searchHydratedKeys, searchValue]
  );

  const onMenuItemClick = useCallback(
    (key: string, item: IKnowledgeDetailTreeItem) => {
      if (key === 'rename') {
        modalAction.handleShow('edit', item);
      } else if (key === 'delete') {
        modal.confirm({
          title: intl.formatMessage({ id: 'common.deleteTips' }),
          content: item.title,
          onOk: () =>
            new Promise<void>((resolve) => {
              delFolderOrFile(item, String(dataset.resourceId))
                .then(() => {
                  message.success(intl.formatMessage({ id: 'common.deleteSuccess' }));
                  setTreeData((prev) => deleteTreeNode(prev, key));
                })
                .finally(resolve);
            }),
        });
      } else if (key === 'preview') {
        void handlePreviewFile(item);
      } else if (key === 'download') {
        const directoryPath = resolveTreeItemDirectoryPath(item);
        if (!directoryPath) {
          message.warning(intl.formatMessage({ id: 'directoryManage.resolveFilePathFailed' }));
          return;
        }
        message.loading('');
        downloadResourceFile({
          resourceId: dataset.resourceId,
          directoryPath: item.type === 'directory' ? ensureDirectoryPath(directoryPath) : directoryPath,
        }).then((res) => {
          message.destroy();
          downloadFile(res);
        });
      } else if (key === 'saveToSessionFiles') {
        openSaveToFileBrowser(item, 'session');
      } else if (key === 'saveToSharedFiles') {
        openSaveToFileBrowser(item, 'shared');
      }
    },
    [dataset.resourceId, handlePreviewFile, intl, message, modal, modalAction, openSaveToFileBrowser]
  );

  return (
    <ConfigProvider>
      <div className={commonStyles.container}>
        <div className={commonStyles.searchArea}>
          <Breadcrumb
            className={commonStyles.breadcrumb}
            style={{ marginTop: 0 }}
            items={[
              {
                key: '-1',
                title: (
                  <span>
                    <LeftOutlined />
                    {intl.formatMessage({ id: 'dialogueRecord.all' })}
                  </span>
                ),
                onClick: onGoBack,
              },
              { key: dataset.resourceId, title: dataset.resourceName },
            ]}
          />
          <div className={commonStyles.searchControls}>
            <Input.Search
              allowClear
              placeholder={intl.formatMessage({ id: 'selectMember.searchPlaceholder' })}
              onSearch={setSearchValue}
              className={commonStyles.searchInput}
            />
          </div>
        </div>
        <Spin spinning={loading} wrapperClassName={commonStyles.listSpinner}>
          <div ref={treeWrap} style={{ height: '100%' }}>
            <Tree.DirectoryTree
              showIcon
              allowDrop={() => false}
              onDragStart={onDragStart}
              selectable={false}
              height={virtualHeight}
              treeData={treeData}
              loadData={expandFolder}
              onExpand={(_, info) => {
                if (info.expanded) {
                  void hydrateSearchDirectoryChildren(info.node as EventDataNode<IKnowledgeDetailTreeItem>);
                }
              }}
              icon={getNodeIcon}
              className={classnames(commonStyles.tree, {
                [styles.selectable]: !!onSelect,
                [styles.notselectable]: !onSelect,
              })}
              onClick={handleTreeNodeClick}
              onDoubleClick={handleTreeNodeDoubleClick}
              draggable={editable ? { icon: <span /> } : false}
              titleRender={(item) => {
                if (!editable) {
                  return item.title;
                }
                const menus = [];
                if (`${item.createUserId}` === `${userInfo.userId}`) {
                  menus.push(
                    { key: 'rename', label: intl.formatMessage({ id: 'directoryManage.rename' }) },
                    { key: 'delete', label: intl.formatMessage({ id: 'common.delete' }) }
                  );
                }
                const canPreview = item.type === 'file' && isPreviewable(getKnowledgeItemName(item));
                const fileBrowserMenus = [
                  ...(canPreview
                    ? [
                      {
                        key: 'preview',
                        label: intl.formatMessage({ id: 'fileBrowser.action.preview' }),
                      },
                    ]
                    : []),
                  {
                    key: 'download',
                    label: intl.formatMessage({ id: 'directoryManage.downloadFile' }),
                  },
                  {
                    key: 'saveToSessionFiles',
                    label: intl.formatMessage({ id: 'fileBrowser.save.toSessionFiles' }),
                  },
                  {
                    key: 'saveToSharedFiles',
                    label: intl.formatMessage({ id: 'fileBrowser.save.toSharedFiles' }),
                  },
                ];
                if (fileBrowserMenus.length) {
                  menus.unshift(...fileBrowserMenus);
                }
                return (
                  <>
                    {item.title}
                    <Dropdown
                      trigger={['hover']}
                      menu={{
                        items: menus,
                        onClick: ({ key, domEvent }) => {
                          domEvent.stopPropagation();
                          onMenuItemClick(key, item);
                        },
                      }}
                    >
                      <EllipsisOutlined
                        className={commonStyles.treeActionIcon}
                        onClick={(event) => event.stopPropagation()}
                        onMouseDown={(event) => event.stopPropagation()}
                      />
                    </Dropdown>
                  </>
                );
              }}
            />
          </div>
        </Spin>
      </div>
      <RenameModal
        {...modalState}
        onCancel={modalAction.onCancel}
        resourceId={dataset.resourceId}
        onSuccess={async () => {
          await qryFlatternList('-1');
        }}
      />
      <Modal
        open={copyModalOpen}
        title={intl.formatMessage({
          id: copyTargetType === 'session' ? 'fileBrowser.copy.toSessionTitle' : 'fileBrowser.copy.toSharedTitle',
        })}
        okText={intl.formatMessage({ id: 'common.confirm' })}
        cancelText={intl.formatMessage({ id: 'common.cancel' })}
        confirmLoading={copyingToFileBrowser}
        onOk={handleConfirmSaveToFileBrowser}
        onCancel={() => {
          if (copyingToFileBrowser) return;
          setCopyModalOpen(false);
          setCopyTarget(null);
        }}
        destroyOnClose
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Typography.Text type="secondary">
            {intl.formatMessage({ id: 'fileBrowser.copy.source' })}
            {copyTarget ? getKnowledgeItemName(copyTarget) : ''}
          </Typography.Text>
          <Typography.Text>
            {intl.formatMessage({ id: 'fileBrowser.copy.targetDirectory' })}
            {copyDirectoryPath}
          </Typography.Text>
          <Breadcrumb
            items={copyFolderPath.map((folder, index) => ({
              key: folder.id,
              title: (
                <span
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    const target = copyFolderPath[index];
                    if (target) {
                      void loadCopyFolders(target.id);
                    }
                  }}
                >
                  {folder.title}
                </span>
              ),
            }))}
          />
          <Spin spinning={copyFolderLoading}>
            <List
              dataSource={copyFolders}
              locale={{ emptyText: intl.formatMessage({ id: 'fileBrowser.copy.noSubFolder' }) }}
              renderItem={(folder) => (
                <List.Item
                  onClick={() => {
                    void loadCopyFolders(buildTargetFolderPath(copyDirectoryPath, folder.name));
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <List.Item.Meta
                    avatar={<AntdIcon type="icon-wenjianjialanse" />}
                    title={<Typography.Text>{folder.name}</Typography.Text>}
                  />
                </List.Item>
              )}
            />
          </Spin>
        </Space>
      </Modal>
    </ConfigProvider>
  );
};

export default KnowledgeBaseDetail;
