import React, { useState, useRef, useEffect, useCallback, useContext, useMemo } from 'react';
import { Input, Breadcrumb, Tree, Spin, App, ConfigProvider, Dropdown, Button, Tooltip, Upload } from 'antd';
import { EllipsisOutlined, LeftOutlined } from '@ant-design/icons';
import classnames from 'classnames';
import { AntdTreeNodeAttribute, EventDataNode } from 'antd/es/tree';
import AntdIcon from '@/components/AntdIcon';
import CopyToFileBrowserModal from '@/components/CopyToFileBrowserModal';
import UploadConfirmModal, { type UploadConfirmFile } from '@/components/UploadConfirmModal';
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
import {
  checkUploadFileConflicts,
  uploadFiles as uploadKnowledgeFiles,
  type QueryDirAndFileByLevelItem,
} from '@/service/knowledgeCenter';
import { downloadFile } from '@/utils/file';
import { getFileIconType } from '@/constants/icon';
import {
  getMimeType,
  isPreviewable,
} from '@/components/QueryInput/components/FileBrowserEntry/components/FileBrowserPanel/constants';
import useShowModal from '@/hooks/useShowModal';
import RenameModal from '@/pages/knowledgeDetail/components/RenameModal';
import AddFolderModal from '@/pages/knowledgeDetail/components/AddFolderModal';
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

function getParentDirectoryPath(path: string) {
  const normalizedPath = ensureDirectoryPath(normalizeKnowledgePath(path));
  const segments = normalizedPath.split('/').filter(Boolean);
  if (segments.length <= 1) return '/';
  return `/${segments.slice(0, -1).join('/')}/`;
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

function getNormalizedSessionId(sessionId?: string) {
  return `${sessionId || ''}`.trim();
}

function getMessagePayloadSessionId(payload: any) {
  return getNormalizedSessionId(
    payload?.sessionId ||
      payload?.currentSessionId ||
      payload?.message?.sessionId ||
      payload?.message?.currentSessionId ||
      payload?.data?.sessionId ||
      payload?.data?.currentSessionId
  );
}

function getFileIdentity(file: any) {
  return (
    file?.fileCode || file?.objectKey || file?.path || file?.url || file?.downloadUrl || file?.name || file?.fileName
  );
}

function getMessageFilesSignature(message: any) {
  return [...(message?.fileList || []), ...(message?.imageList || []), ...(message?.files || [])]
    .map(getFileIdentity)
    .filter(Boolean)
    .join(',');
}

function getMessageContentFileSignature(content: any) {
  const substance = content?.substance || {};
  return [
    ...(content?.fileList || []),
    ...(content?.imageList || []),
    ...(content?.files || []),
    ...(substance?.fileList || []),
    ...(substance?.imageList || []),
    ...(substance?.files || []),
  ]
    .map(getFileIdentity)
    .filter(Boolean)
    .join(',');
}

function getMessageFileSignature(messageList: any[]) {
  return (messageList || [])
    .map((message) => {
      const itemSignature = [...(message?.thinkList || []), ...(message?.messageList || [])]
        .map((item: any) =>
          [
            item?.contentType || '',
            item?.status || '',
            item?.content?.orderId || '',
            getMessageContentFileSignature(item?.content),
          ].join(':')
        )
        .join(';');
      return [
        message?.messageId || message?.msgId || '',
        message?.messageState ?? '',
        message?.status || '',
        getMessageFilesSignature(message),
        itemSignature,
      ].join(':');
    })
    .join('|');
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
    id: String(item.id ?? item.directoryPath ?? ''),
    collectionName: item.name,
    datasetId,
    type: item.type,
    fileId: item.fileId !== null && item.fileId !== undefined ? String(item.fileId) : undefined,
    parentId,
    directoryPath,
    title: item.name,
    key: pathKey,
    isLeaf: item.type === 'file',
    resourceCode: JSON.stringify({
      parentId,
      datasetId,
      directoryPath,
    }),
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

function isSameTreeNodeKey(a: React.Key, b: React.Key) {
  const normalize = (key: React.Key) => {
    const value = String(key ?? '');
    return value.length > 1 ? value.replace(/\/+$/, '') : value;
  };
  return normalize(a) === normalize(b);
}

function mergeTreeNodeChildren(
  list: IKnowledgeDetailTreeItem[],
  key: React.Key,
  children: IKnowledgeDetailTreeItem[]
): IKnowledgeDetailTreeItem[] {
  return list.map((node) => {
    if (isSameTreeNodeKey(node.key, key)) {
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
  onTreeNodeDragStart(info.event, data, data.type === 'file' ? DragType.knowledgeFile : DragType.knowledgeFolder);
}

function getNodeIcon(p: AntdTreeNodeAttribute) {
  const { isLeaf, title } = p;
  const data = p as unknown as Partial<IKnowledgeDetailTreeItem>;
  const isDirectory = data.type === 'directory' || !isLeaf;
  const { expanded } = p as AntdTreeNodeAttribute & { expanded?: boolean };
  const iconType =
    isDirectory && expanded
      ? 'a-Folder-openwenjianjia-kai'
      : getFileIconType(title as string, {
        isDirectory,
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
  const expandedDirKeysRef = useRef<Set<string>>(new Set());
  const messageFileSignatureRef = useRef('');
  const messageFileSignatureSessionIdRef = useRef('');
  const virtualHeight = useVirtualHeight(treeWrap);
  const { EventEmitter, sessionId } = useGlobal();
  const activeSessionId = useMemo(() => getNormalizedSessionId(sessionId), [sessionId]);
  const currentSessionMessageFileSignature = useSelector((state: any) => {
    if (!activeSessionId) return '';
    const messageInfo = state?.messageStore?.sessionListMap?.get?.(`${activeSessionId}`);
    return getMessageFileSignature(messageInfo?.list || []);
  });

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
  const [addFolderOpen, setAddFolderOpen] = useState(false);
  const [addFolderParentPath, setAddFolderParentPath] = useState('/');
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadConfirmOpen, setUploadConfirmOpen] = useState(false);
  const [pendingUploadFiles, setPendingUploadFiles] = useState<File[]>([]);
  const [pendingUploadPath, setPendingUploadPath] = useState('/');
  const [pendingUploadConflicts, setPendingUploadConflicts] = useState<string[]>([]);

  const copyFolderPath = useMemo(() => {
    const rootPath = copyTargetType === 'session' ? '/.sessions/' : SHARED_FILES_PATH;
    return buildScopedFolderPath(copyDirectoryPath, rootPath);
  }, [copyDirectoryPath, copyTargetType]);

  const qryFlatternList = useCallback(
    async (parentId: string, options?: { rootLoading?: boolean }) => {
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
    },
    [dataset.resourceId, dataset.resourceSourcePkId]
  );

  const repopulateExpandedDirectories = useCallback(async () => {
    const expandedKeys = Array.from(expandedDirKeysRef.current);
    if (!expandedKeys.length) return;
    // 按路径深度升序，确保父目录先于子目录被填充
    const orderedKeys = expandedKeys.sort(
      (a, b) => a.split('/').filter(Boolean).length - b.split('/').filter(Boolean).length
    );
    for (const key of orderedKeys) {
      const children = await qryFlatternList(key, { rootLoading: false });
      setTreeData((origin) => mergeTreeNodeChildren(origin, key, children));
    }
  }, [qryFlatternList]);

  const refreshKnowledgeDetail = useCallback(
    async (options?: { rootLoading?: boolean }) => {
      const keyword = searchValue.trim();
      setSearchHydratedKeys(new Set());
      if (!keyword) {
        await qryFlatternList('-1', options);
        await repopulateExpandedDirectories();
        return;
      }

      if (options?.rootLoading !== false) {
        setLoading(true);
      }
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
    },
    [dataset.resourceId, dataset.resourceSourcePkId, qryFlatternList, repopulateExpandedDirectories, searchValue]
  );

  const refreshKnowledgeDirectory = useCallback(
    async (directoryPath: string) => {
      if (searchValue.trim()) {
        await refreshKnowledgeDetail();
        return;
      }
      const normalizedDirectoryPath = normalizeKnowledgePath(directoryPath || '/');
      if (normalizedDirectoryPath === '/') {
        await qryFlatternList('-1');
        await repopulateExpandedDirectories();
        return;
      }
      setLoading(true);
      try {
        const children = await qryFlatternList(normalizedDirectoryPath, { rootLoading: false });
        setTreeData((origin) => mergeTreeNodeChildren(origin, normalizedDirectoryPath, children));
      } finally {
        setLoading(false);
      }
    },
    [qryFlatternList, refreshKnowledgeDetail, repopulateExpandedDirectories, searchValue]
  );

  const getTreeItemDirectoryPath = useCallback((item: IKnowledgeDetailTreeItem) => {
    if (item.type === 'directory') {
      return ensureDirectoryPath(resolveTreeItemDirectoryPath(item) || '/');
    }
    return getParentDirectoryPath(resolveTreeItemDirectoryPath(item) || '/');
  }, []);

  const openAddFolder = useCallback((parentPath: string) => {
    setAddFolderParentPath(ensureDirectoryPath(parentPath || '/'));
    setAddFolderOpen(true);
  }, []);

  const handleUploadSelect = useCallback(
    async (targetPath: string, fileList: File[]) => {
      if (!fileList.length) return;
      const uploadPath = ensureDirectoryPath(targetPath || '/');
      try {
        const conflictResult = await checkUploadFileConflicts({
          resourceId: dataset.resourceId,
          directoryPath: uploadPath,
          fileNames: fileList.map((file) => file.name),
        });
        setPendingUploadPath(uploadPath);
        setPendingUploadFiles(fileList);
        setPendingUploadConflicts(conflictResult?.overwritePaths || []);
        setUploadConfirmOpen(true);
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.upload.failed' }));
      }
    },
    [dataset.resourceId, intl, message]
  );

  const handleUploadConfirmOk = useCallback(
    async (processFrontMatter: boolean) => {
      if (!pendingUploadFiles.length) return;
      const formData = new FormData();
      pendingUploadFiles.forEach((file) => {
        formData.append('files', file);
      });
      formData.append('resourceId', String(dataset.resourceId));
      formData.append('directoryPath', pendingUploadPath);
      formData.append('processFrontMatter', String(processFrontMatter));
      formData.append('overwrite', String(pendingUploadConflicts.length > 0));

      setUploadLoading(true);
      try {
        await uploadKnowledgeFiles(formData);
        message.success(intl.formatMessage({ id: 'knowledgeDetail.uploadSuccess' }));
        setUploadConfirmOpen(false);
        setPendingUploadFiles([]);
        setPendingUploadConflicts([]);
        await refreshKnowledgeDirectory(pendingUploadPath);
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.upload.failed' }));
      } finally {
        setUploadLoading(false);
      }
    },
    [
      dataset.resourceId,
      intl,
      message,
      pendingUploadConflicts.length,
      pendingUploadFiles,
      pendingUploadPath,
      refreshKnowledgeDirectory,
    ]
  );

  const handleUploadConfirmCancel = useCallback(() => {
    if (uploadLoading) return;
    setUploadConfirmOpen(false);
    setPendingUploadFiles([]);
    setPendingUploadConflicts([]);
  }, [uploadLoading]);

  useEffect(() => {
    void refreshKnowledgeDetail();
  }, [refreshKnowledgeDetail]);

  useEffect(() => {
    if (!activeSessionId) {
      messageFileSignatureRef.current = '';
      messageFileSignatureSessionIdRef.current = '';
      return;
    }

    if (messageFileSignatureSessionIdRef.current !== activeSessionId) {
      messageFileSignatureRef.current = currentSessionMessageFileSignature;
      messageFileSignatureSessionIdRef.current = activeSessionId;
      return;
    }

    if (messageFileSignatureRef.current === currentSessionMessageFileSignature) return;
    messageFileSignatureRef.current = currentSessionMessageFileSignature;
    void refreshKnowledgeDetail();
  }, [activeSessionId, currentSessionMessageFileSignature, refreshKnowledgeDetail]);

  useEffect(() => {
    let refreshTimer: number | null = null;

    // 回答完成后合并刷新一次，避免流式过程中频繁刷新
    const scheduleRefresh = () => {
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
      }
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void refreshKnowledgeDetail();
      }, 500);
    };

    const handleAnswerCompleted = (payload?: any) => {
      const payloadSessionId = getMessagePayloadSessionId(payload);
      if (payloadSessionId && activeSessionId && payloadSessionId !== activeSessionId) {
        return;
      }
      scheduleRefresh();
    };

    EventEmitter.on('chat-answer-completed', handleAnswerCompleted);
    return () => {
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
      }
      EventEmitter.off('chat-answer-completed', handleAnswerCompleted);
    };
  }, [EventEmitter, activeSessionId, refreshKnowledgeDetail]);

  useEffect(() => {
    const handleSiderMenuRefresh = (payload?: { key?: string }) => {
      if (payload?.key === 'knowledge') {
        void refreshKnowledgeDetail();
      }
    };

    EventEmitter.on('sider-menu-tab-click-refresh', handleSiderMenuRefresh);
    return () => {
      EventEmitter.off('sider-menu-tab-click-refresh', handleSiderMenuRefresh);
    };
  }, [EventEmitter, refreshKnowledgeDetail]);

  const clearTreeClickTimer = useCallback(() => {
    if (treeClickTimerRef.current !== null) {
      window.clearTimeout(treeClickTimerRef.current);
      treeClickTimerRef.current = null;
    }
  }, []);

  const getTreeNodeDragType = useCallback(
    (item: IKnowledgeDetailTreeItem): IDragType =>
      item.type === 'file' ? DragType.knowledgeFile : DragType.knowledgeFolder,
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
      if (!isPreviewable(fileName)) {
        message.warning(intl.formatMessage({ id: 'fileBrowser.preview.unavailable' }));
        return;
      }

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
    [qryFlatternList, searchHydratedKeys, searchValue]
  );

  const onMenuItemClick = useCallback(
    (key: string, item: IKnowledgeDetailTreeItem) => {
      if (key === 'rename') {
        modalAction.handleShow('edit', item);
      } else if (key === 'createFolder') {
        openAddFolder(getTreeItemDirectoryPath(item));
      } else if (key === 'createSiblingFolder') {
        openAddFolder(getParentDirectoryPath(resolveTreeItemDirectoryPath(item) || '/'));
      } else if (key === 'delete') {
        const parentDirectoryPath = getParentDirectoryPath(resolveTreeItemDirectoryPath(item) || '/');
        modal.confirm({
          title: intl.formatMessage({ id: 'common.deleteTips' }),
          content: item.title,
          onOk: () =>
            new Promise<void>((resolve) => {
              delFolderOrFile(item, String(dataset.resourceId))
                .then(() => {
                  message.success(intl.formatMessage({ id: 'common.deleteSuccess' }));
                  setTreeData((prev) => deleteTreeNode(prev, key));
                  void refreshKnowledgeDirectory(parentDirectoryPath);
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
    [
      dataset.resourceId,
      getTreeItemDirectoryPath,
      handlePreviewFile,
      intl,
      message,
      modal,
      modalAction,
      openAddFolder,
      openSaveToFileBrowser,
      refreshKnowledgeDirectory,
    ]
  );

  const refreshTitle = intl.formatMessage({ id: 'fileBrowser.toolbar.refresh' });

  return (
    <ConfigProvider>
      <div className={commonStyles.container}>
        <div className={commonStyles.searchArea}>
          <div className={styles.detailBreadcrumbRow}>
            <Breadcrumb
              className={commonStyles.breadcrumb}
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
            <Tooltip title={refreshTitle}>
              <Button
                size="small"
                icon={<AntdIcon type="icon-a-Refreshshuaxin1" className={styles.categoryActionIcon} />}
                title={intl.formatMessage({ id: 'fileBrowser.toolbar.refresh' })}
                onClick={() => {
                  void refreshKnowledgeDetail();
                }}
              />
            </Tooltip>
          </div>
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
          <div ref={treeWrap} className={styles.treeWrap}>
            <Tree.DirectoryTree
              showIcon
              allowDrop={() => false}
              onDragStart={onDragStart}
              selectable={false}
              height={virtualHeight}
              treeData={treeData}
              loadData={expandFolder}
              onExpand={(_, info) => {
                const node = info.node as EventDataNode<IKnowledgeDetailTreeItem>;
                const nodeKey = String(node.key);
                if (info.expanded) {
                  if (node.type !== 'file') {
                    expandedDirKeysRef.current.add(nodeKey);
                  }
                  void hydrateSearchDirectoryChildren(node);
                } else {
                  expandedDirKeysRef.current.delete(nodeKey);
                }
              }}
              icon={getNodeIcon}
              className={classnames(commonStyles.tree, styles.knowledgeTree, {
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
                if (item.type === 'directory') {
                  menus.push(
                    {
                      key: 'upload',
                      label: (
                        <Upload
                          showUploadList={false}
                          multiple
                          beforeUpload={(_, fileList) => {
                            void handleUploadSelect(getTreeItemDirectoryPath(item), fileList as unknown as File[]);
                            return false;
                          }}
                        >
                          <div>{intl.formatMessage({ id: 'knowledgeDetail.uploadFile' })}</div>
                        </Upload>
                      ),
                    },
                    { key: 'createFolder', label: intl.formatMessage({ id: 'knowledgeDetail.newSubFolder' }) },
                    {
                      key: 'createSiblingFolder',
                      label: intl.formatMessage({ id: 'knowledgeDetail.newSiblingFolder' }),
                    }
                  );
                }
                const canPreview = item.type === 'file' && isPreviewable(getKnowledgeItemName(item));
                menus.push(
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
                  { key: 'rename', label: intl.formatMessage({ id: 'directoryManage.rename' }) },
                  { key: 'delete', label: intl.formatMessage({ id: 'common.delete' }) },
                  {
                    key: 'saveToSessionFiles',
                    label: intl.formatMessage({ id: 'fileBrowser.save.toSessionFiles' }),
                  },
                  {
                    key: 'saveToSharedFiles',
                    label: intl.formatMessage({ id: 'fileBrowser.save.toSharedFiles' }),
                  }
                );
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
          const target = modalState.data as IKnowledgeDetailTreeItem | undefined;
          const parentDirectoryPath = target
            ? getParentDirectoryPath(resolveTreeItemDirectoryPath(target) || '/')
            : '/';
          await refreshKnowledgeDirectory(parentDirectoryPath);
        }}
      />
      {addFolderOpen && (
        <AddFolderModal
          baseInfo={dataset}
          parentDirectoryPath={addFolderParentPath}
          onCancel={() => setAddFolderOpen(false)}
          reload={() => {
            setAddFolderOpen(false);
            void refreshKnowledgeDirectory(addFolderParentPath);
          }}
        />
      )}
      <UploadConfirmModal
        open={uploadConfirmOpen}
        files={pendingUploadFiles as UploadConfirmFile[]}
        directoryPath={pendingUploadPath}
        conflicts={pendingUploadConflicts}
        loading={uploadLoading}
        showProcessFrontMatter
        okText={intl.formatMessage({
          id: pendingUploadConflicts.length ? 'knowledgeDetail.confirmOverwriteUpload' : 'knowledgeDetail.uploadFile',
        })}
        onOk={handleUploadConfirmOk}
        onCancel={handleUploadConfirmCancel}
      />
      <CopyToFileBrowserModal
        open={copyModalOpen}
        targetType={copyTargetType}
        sourceName={copyTarget ? getKnowledgeItemName(copyTarget) : ''}
        targetDirectory={copyDirectoryPath}
        folderPath={copyFolderPath}
        folders={copyFolders}
        loading={copyFolderLoading}
        confirmLoading={copyingToFileBrowser}
        onOk={handleConfirmSaveToFileBrowser}
        onCancel={() => {
          if (copyingToFileBrowser) return;
          setCopyModalOpen(false);
          setCopyTarget(null);
        }}
        onBreadcrumbClick={(target) => {
          void loadCopyFolders(target.id);
        }}
        onFolderClick={(folder) => {
          void loadCopyFolders(buildTargetFolderPath(copyDirectoryPath, folder.name));
        }}
      />
    </ConfigProvider>
  );
};

export default KnowledgeBaseDetail;
