import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Collapse,
  Dropdown,
  Empty,
  Input,
  List,
  Modal,
  Space,
  Spin,
  Tooltip,
  Tree,
  Typography,
  Upload,
  message,
} from 'antd';
import { EllipsisOutlined, SearchOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import AntdIcon from '@/components/AntdIcon';
import KnowledgeBreadcrumb from '@/components/KnowledgeBreadcrumb';
import { DragType } from '@/components/QueryInput/withDrag';
import employeeStyles from '@/layout/sider/components/EmployeeList/index.module.less';
import useGlobal from '@/hooks/useGlobal';
import { HALF_MAIN_CONTENT_DETAIL_PANEL_WIDTH, SiderContentContext } from '@/layout/sider/siderContentContext';
import {
  getMimeType,
  isPreviewable,
} from '@/components/QueryInput/components/FileBrowserEntry/components/FileBrowserPanel/constants';
import {
  copyFile,
  downloadFile,
  downloadFolder,
  ensureFolder,
  listFiles,
  searchFiles,
  uploadFiles,
  type FileBrowserItem,
} from '@/service/fileBrowser';
import { queryDigEmployeeManageKnowledgeResourceAuth } from '@/pages/manager/service/resources';
import {
  createFolder as createKnowledgeFolder,
  queryDirAndFileByLevel,
  uploadFiles as uploadKnowledgeFiles,
  type QueryDirAndFileByLevelItem,
} from '@/service/knowledgeCenter';
import type { IKnowledgeBaseItem } from '@/layout/sider/components/Knowledge/components/KnowledgeBase/types';
import { getKnowledgeFileIconType } from '@/constants/icon';
import commonStyles from '../Knowledge/components/common.module.less';
import styles from './index.module.less';

const PreViewFile = React.lazy(() =>
  import('@/components/Preview/Twins').then((module) => ({ default: module.PreViewFile }))
);

function getIconType(name: string, isDir: boolean): string {
  return getKnowledgeFileIconType(name, {
    isDirectory: isDir,
    directoryIconType: 'wenjianjialanse',
  });
}

function isDirectory(item: FileBrowserItem) {
  return item.isDir || (item as any).dir;
}

function unwrapListResponse<T>(res: any): T[] {
  const data = res?.data ?? res ?? [];
  return Array.isArray(data) ? data : [];
}

function ensureDirectoryPath(path: string) {
  return path.endsWith('/') ? path : `${path}/`;
}

function getPathDepth(path: string) {
  return path.split('/').filter(Boolean).length;
}

function sortFileBrowserItems(items: FileBrowserItem[]) {
  const dirs = items.filter((item) => isDirectory(item));
  const files = items.filter((item) => !isDirectory(item));
  return [...dirs, ...files];
}

function joinKnowledgeDirectoryPath(parentPath: string, name: string) {
  return `${ensureDirectoryPath(parentPath)}${name}/`.replace(/\/+/g, '/');
}

function getRawBlob(res: any) {
  return res?.file instanceof Blob ? res.file : res instanceof Blob ? res : new Blob([res?.file || res]);
}

function toFileTreeData(list: FileBrowserItem[], childrenByPath: Record<string, FileBrowserItem[]>): FileTreeItem[] {
  return sortFileBrowserItems(list).map((item) => {
    const dir = isDirectory(item);
    const directoryPath = ensureDirectoryPath(item.path);
    return {
      ...item,
      key: dir ? directoryPath : item.path,
      title: <span>{item.name}</span>,
      isLeaf: !dir,
      children:
        dir && childrenByPath[directoryPath]
          ? toFileTreeData(childrenByPath[directoryPath], childrenByPath)
          : undefined,
    };
  });
}

function normalizeReferenceItem(item: FileBrowserItem, resourceId: string) {
  const dir = isDirectory(item);
  return {
    ...item,
    id: item.path,
    collectionName: item.name,
    resourceId,
    type: dir ? 'directory' : 'file',
  };
}

function getFileType(name: string): string {
  const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() || '' : '';
  if (ext === 'jpeg') return 'jpg';
  if (['html', 'htm'].includes(ext)) return 'h5';
  return ext;
}

function formatFileSize(size: number) {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} B`;
}

interface FileMiniListProps {
  resourceId: string;
}

interface FilePreviewPanelProps {
  blob: Blob | null;
  fileName: string;
  fileType: string;
  loading: boolean;
  onClose: () => void;
}

interface FileTreeItem extends FileBrowserItem {
  key: string;
  title: React.ReactNode;
  isLeaf: boolean;
  children?: FileTreeItem[];
}

type FileCategoryKey = 'root' | 'session' | 'shared' | 'log';
type FileCopyTargetType = 'session' | 'shared';
type FileActionKey = 'upload' | 'download' | 'saveToKnowledge' | 'saveToSessionFiles' | 'saveToSharedFiles';

interface FileCategoryItem {
  key: FileCategoryKey;
  titleId: string;
  path: string;
  ensure?: boolean;
}

const ROOT_FILE_PATH = '/';
const BYKC_FILE_PATH = '/.bykc/';
const SESSION_FILE_PATH = '/.sessions/';
const SHARED_FILE_PATH = '/.shared/';
const LOG_FILE_PATH = '/.log/';

function getNormalizedSessionId(sessionId?: string) {
  return `${sessionId || ''}`.trim();
}

function getSessionFilePath(sessionId?: string) {
  const normalizedSessionId = getNormalizedSessionId(sessionId);
  return normalizedSessionId ? `${SESSION_FILE_PATH}${normalizedSessionId}/` : SESSION_FILE_PATH;
}

function getDefaultFileCategoryKey(sessionId?: string): FileCategoryKey {
  return getNormalizedSessionId(sessionId) ? 'session' : 'root';
}

function getFileCategoryRootPath(categoryKey?: FileCategoryKey) {
  if (categoryKey === 'session') return SESSION_FILE_PATH;
  if (categoryKey === 'shared') return SHARED_FILE_PATH;
  if (categoryKey === 'log') return LOG_FILE_PATH;
  return ROOT_FILE_PATH;
}

function normalizeFileBrowserPath(path?: string) {
  const normalizedPath = `${path || '/'}`.trim().replace(/\\/g, '/').replace(/\/+/g, '/');
  if (!normalizedPath || normalizedPath === '/') {
    return '/';
  }
  return normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`;
}

function isPathIn(path: string, rootPath: string) {
  const normalizedPath = normalizeFileBrowserPath(path).toLowerCase();
  const normalizedRoot = ensureDirectoryPath(normalizeFileBrowserPath(rootPath)).toLowerCase();
  return normalizedPath === normalizedRoot.slice(0, -1) || normalizedPath.startsWith(normalizedRoot);
}

function getFileActionScope(activeKey: FileCategoryKey | undefined, item: FileBrowserItem) {
  if (activeKey && activeKey !== 'root') {
    return activeKey;
  }
  const itemPath = normalizeFileBrowserPath(item.path);
  if (isPathIn(itemPath, BYKC_FILE_PATH)) return 'bykc';
  if (isPathIn(itemPath, SESSION_FILE_PATH)) return 'session';
  if (isPathIn(itemPath, SHARED_FILE_PATH)) return 'shared';
  if (isPathIn(itemPath, LOG_FILE_PATH)) return 'log';
  return 'root';
}

function getCopyTargetPath(targetType: FileCopyTargetType, sessionId?: string) {
  return targetType === 'session' ? getSessionFilePath(sessionId) : SHARED_FILE_PATH;
}

function buildTargetFolderPath(parentPath: string, folderName: string) {
  return `${ensureDirectoryPath(parentPath)}${folderName}/`.replace(/\/+/g, '/');
}

function buildScopedFolderPath(currentPath: string, rootPath: string) {
  const scopedRoot = ensureDirectoryPath(normalizeFileBrowserPath(rootPath));
  const scopedCurrent = ensureDirectoryPath(normalizeFileBrowserPath(currentPath));
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

const FileMiniList: React.FC<FileMiniListProps> = ({ resourceId }) => {
  const intl = useIntl();
  const { EventEmitter, sessionId } = useGlobal();
  const { setDetailPanel, clearDetailPanel } = useContext(SiderContentContext);
  const clickTimerRef = useRef<number | null>(null);
  const [currentPath, setCurrentPath] = useState('');
  const [activeCategoryKey, setActiveCategoryKey] = useState<FileCategoryKey | undefined>('root');
  const [items, setItems] = useState<FileBrowserItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [pathInitialized, setPathInitialized] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [childrenByPath, setChildrenByPath] = useState<Record<string, FileBrowserItem[]>>({});
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveTarget, setSaveTarget] = useState<FileBrowserItem | null>(null);
  const [knowledgeKeyword, setKnowledgeKeyword] = useState('');
  const [knowledgeBases, setKnowledgeBases] = useState<IKnowledgeBaseItem[]>([]);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [selectedKnowledgeBase, setSelectedKnowledgeBase] = useState<IKnowledgeBaseItem | null>(null);
  const [knowledgeDirectoryPath, setKnowledgeDirectoryPath] = useState('/');
  const [knowledgeFolders, setKnowledgeFolders] = useState<QueryDirAndFileByLevelItem[]>([]);
  const [knowledgeFolderLoading, setKnowledgeFolderLoading] = useState(false);
  const [savingToKnowledge, setSavingToKnowledge] = useState(false);
  const [uploadConfirmOpen, setUploadConfirmOpen] = useState(false);
  const [pendingUploadFiles, setPendingUploadFiles] = useState<File[]>([]);
  const [pendingUploadPath, setPendingUploadPath] = useState('');
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const [copyTarget, setCopyTarget] = useState<FileBrowserItem | null>(null);
  const [copyTargetType, setCopyTargetType] = useState<FileCopyTargetType>('session');
  const [copyDirectoryPath, setCopyDirectoryPath] = useState('/');
  const [copyFolders, setCopyFolders] = useState<FileBrowserItem[]>([]);
  const [copyFolderLoading, setCopyFolderLoading] = useState(false);
  const [copyingToFileBrowser, setCopyingToFileBrowser] = useState(false);

  const fileCategories = useMemo<FileCategoryItem[]>(() => {
    return [
      {
        key: 'root',
        titleId: 'fileBrowser.category.root',
        path: ROOT_FILE_PATH,
      },
      {
        key: 'session',
        titleId: 'fileBrowser.category.session',
        path: getSessionFilePath(sessionId),
      },
      {
        key: 'shared',
        titleId: 'fileBrowser.category.shared',
        path: SHARED_FILE_PATH,
        ensure: true,
      },
      {
        key: 'log',
        titleId: 'fileBrowser.category.log',
        path: LOG_FILE_PATH,
        ensure: true,
      },
    ];
  }, [sessionId]);

  const activeCategory = useMemo(() => {
    return fileCategories.find((item) => item.key === activeCategoryKey);
  }, [activeCategoryKey, fileCategories]);

  const fetchList = useCallback(
    async (path: string) => {
      setLoading(true);
      try {
        const res: any = await listFiles({ resourceId, path });
        const data = res?.data ?? res ?? [];
        setItems(Array.isArray(data) ? data : []);
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.error.loadFailed' }));
      } finally {
        setLoading(false);
      }
    },
    [intl, resourceId]
  );

  useEffect(() => {
    const defaultCategoryKey = getDefaultFileCategoryKey(sessionId);
    const defaultCategoryPath = defaultCategoryKey === 'session' ? getSessionFilePath(sessionId) : ROOT_FILE_PATH;
    setPathInitialized(false);
    setActiveCategoryKey(defaultCategoryKey);
    setCurrentPath(defaultCategoryPath);
    setItems([]);
    setSearchValue('');
    setIsSearching(false);
    setChildrenByPath({});
    if (!resourceId) return;
    setPathInitialized(true);
  }, [resourceId, sessionId]);

  useEffect(() => {
    if (resourceId && pathInitialized && currentPath) {
      fetchList(currentPath);
    }
  }, [currentPath, fetchList, pathInitialized, resourceId]);

  useEffect(() => {
    if (!activeCategory || !pathInitialized) return;
    setCurrentPath(activeCategory.path);
  }, [activeCategory?.path, pathInitialized]);

  const handleCategoryChange = useCallback(
    async (key: string | string[]) => {
      const nextKey = Array.isArray(key) ? key[0] : key;
      if (!nextKey) {
        setActiveCategoryKey(undefined);
        return;
      }
      const nextCategory = fileCategories.find((item) => item.key === nextKey);
      if (!nextCategory) return;
      setActiveCategoryKey(nextCategory.key);
      setSearchValue('');
      setIsSearching(false);
      setChildrenByPath({});
      if (nextCategory.ensure) {
        try {
          await ensureFolder({ resourceId, path: nextCategory.path });
        } catch (error: any) {
          message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.createFolder.failed' }));
        }
      }
      setCurrentPath(nextCategory.path);
    },
    [fileCategories, intl, resourceId]
  );

  const folderPath = useMemo(() => {
    const categoryRootPath = getFileCategoryRootPath(activeCategoryKey);
    if (categoryRootPath !== ROOT_FILE_PATH) {
      const rootPath = ensureDirectoryPath(categoryRootPath);
      const normalizedCurrentPath = ensureDirectoryPath(normalizeFileBrowserPath(currentPath));
      const paths = [{ title: intl.formatMessage({ id: 'fileBrowser.root' }), id: rootPath }];
      if (!normalizedCurrentPath.startsWith(rootPath) || normalizedCurrentPath === rootPath) {
        return paths;
      }

      let accumulated = rootPath;
      const childSegments = normalizedCurrentPath.slice(rootPath.length).split('/').filter(Boolean);
      for (const segment of childSegments) {
        accumulated += `${segment}/`;
        paths.push({ title: segment, id: accumulated });
      }
      return paths;
    }

    const segments = currentPath.split('/').filter(Boolean);
    const paths = [{ title: intl.formatMessage({ id: 'fileBrowser.root' }), id: '/' }];
    const firstSegment = segments[0];
    if (firstSegment) {
      paths.push({ title: firstSegment, id: `/${firstSegment}/` });
    }
    return paths;
  }, [activeCategoryKey, currentPath, intl]);

  const sortedItems = useMemo(() => {
    return sortFileBrowserItems(items);
  }, [items]);

  const fileTreeData = useMemo(() => {
    return toFileTreeData(sortedItems, childrenByPath);
  }, [childrenByPath, sortedItems]);

  const knowledgeFolderPath = useMemo(() => {
    const segments = knowledgeDirectoryPath.split('/').filter(Boolean);
    const paths = [{ title: intl.formatMessage({ id: 'fileBrowser.root' }), id: '/' }];
    let accumulated = '/';
    for (const segment of segments) {
      accumulated += `${segment}/`;
      paths.push({ title: segment, id: accumulated });
    }
    return paths;
  }, [intl, knowledgeDirectoryPath]);

  const copyFolderPath = useMemo(() => {
    const rootPath = copyTargetType === 'session' ? SESSION_FILE_PATH : SHARED_FILE_PATH;
    return buildScopedFolderPath(copyDirectoryPath, rootPath);
  }, [copyDirectoryPath, copyTargetType]);

  const loadKnowledgeBases = useCallback(
    async (keyword = knowledgeKeyword) => {
      setKnowledgeLoading(true);
      try {
        const response = await queryDigEmployeeManageKnowledgeResourceAuth({
          resourceId,
          pageNum: 1,
          pageSize: 30,
          keyword: keyword.trim(),
        });
        const rows = Array.isArray(response?.rows) ? response.rows : Array.isArray(response?.list) ? response.list : [];
        setKnowledgeBases(rows);
        if (!rows.length) {
          message.warning(intl.formatMessage({ id: 'fileSider.saveToKnowledge.noManagePermission' }));
        }
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.error.loadFailed' }));
      } finally {
        setKnowledgeLoading(false);
      }
    },
    [intl, knowledgeKeyword, resourceId]
  );

  const loadKnowledgeFolders = useCallback(
    async (kb: IKnowledgeBaseItem, directoryPath: string) => {
      setKnowledgeFolderLoading(true);
      try {
        const response = await queryDirAndFileByLevel({
          resourceId: Number(kb.resourceId),
          directoryPath,
        });
        setKnowledgeFolders(
          unwrapListResponse<QueryDirAndFileByLevelItem>(response).filter((item) => item.type === 'directory')
        );
        setKnowledgeDirectoryPath(directoryPath);
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.error.loadFailed' }));
      } finally {
        setKnowledgeFolderLoading(false);
      }
    },
    [intl]
  );

  const loadCopyFolders = useCallback(
    async (directoryPath: string) => {
      const normalizedPath = ensureDirectoryPath(directoryPath || '/');
      setCopyFolderLoading(true);
      try {
        await ensureFolder({ resourceId, path: normalizedPath });
        const response = await listFiles({ resourceId, path: normalizedPath });
        setCopyFolders(unwrapListResponse<FileBrowserItem>(response).filter((item) => isDirectory(item)));
        setCopyDirectoryPath(normalizedPath);
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.error.loadFailed' }));
      } finally {
        setCopyFolderLoading(false);
      }
    },
    [intl, resourceId]
  );

  const handleBreadcrumbClick = useCallback(
    (index: number) => {
      const target = folderPath[index];
      if (!target) return;
      setSearchValue('');
      setIsSearching(false);
      setChildrenByPath({});
      setCurrentPath(target.id);
    },
    [folderPath]
  );

  const handleSearch = useCallback(
    async (keyword: string) => {
      const nextKeyword = keyword.trim();
      if (!nextKeyword) {
        setIsSearching(false);
        setChildrenByPath({});
        fetchList(currentPath);
        return;
      }
      setIsSearching(true);
      setChildrenByPath({});
      setLoading(true);
      try {
        const res: any = await searchFiles({ resourceId, path: currentPath, keyword: nextKeyword });
        const data = res?.data ?? res ?? [];
        setItems(Array.isArray(data) ? data : []);
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.error.loadFailed' }));
      } finally {
        setLoading(false);
      }
    },
    [currentPath, fetchList, intl, resourceId]
  );

  const clearClickTimer = useCallback(() => {
    if (clickTimerRef.current !== null) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
  }, []);

  const renderPreviewPanel = useCallback(
    (item: FileBrowserItem, options: { blob?: Blob | null; loading: boolean }) => {
      setDetailPanel?.(
        <FilePreviewPanel
          blob={options.blob ?? null}
          fileName={item.name}
          fileType={getFileType(item.name)}
          loading={options.loading}
          onClose={() => clearDetailPanel?.()}
        />,
        { width: HALF_MAIN_CONTENT_DETAIL_PANEL_WIDTH }
      );
    },
    [clearDetailPanel, setDetailPanel]
  );

  const handlePreview = useCallback(
    async (item: FileBrowserItem) => {
      if (!isPreviewable(item.name)) return;

      renderPreviewPanel(item, { loading: true });
      try {
        const res: any = await downloadFile(resourceId, item.path);
        const rawBlob = res?.file instanceof Blob ? res.file : new Blob([res?.file || res]);
        const mimeType = getMimeType(item.name);
        const blob = mimeType ? new Blob([rawBlob], { type: mimeType }) : rawBlob;
        renderPreviewPanel(item, { blob, loading: false });
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.preview.failed' }));
        clearDetailPanel?.();
      }
    },
    [clearDetailPanel, intl, renderPreviewPanel, resourceId]
  );

  const handleDownload = useCallback(
    async (item: FileBrowserItem) => {
      const messageKey = isDirectory(item) ? 'folderDownload' : 'fileDownload';
      message.loading({
        content: intl.formatMessage({
          id: isDirectory(item) ? 'fileBrowser.download.folderDownloading' : 'fileBrowser.download.downloading',
        }),
        key: messageKey,
        duration: 0,
      });
      try {
        const res: any = isDirectory(item)
          ? await downloadFolder(resourceId, ensureDirectoryPath(item.path))
          : await downloadFile(resourceId, item.path);
        const blob = res?.file instanceof Blob ? res.file : new Blob([res?.file || res]);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = res?.fileName || (isDirectory(item) ? `${item.name}.zip` : item.name);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        message.destroy(messageKey);
      } catch (error: any) {
        message.destroy(messageKey);
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.download.failed' }));
      }
    },
    [intl, resourceId]
  );

  const executeUpload = useCallback(
    async (targetPath: string, fileList: File[]) => {
      if (!fileList.length || uploadingFiles) return;
      const uploadPath = ensureDirectoryPath(targetPath || currentPath || '/');
      setUploadingFiles(true);
      try {
        await uploadFiles(resourceId, uploadPath, fileList);
        message.success(intl.formatMessage({ id: 'fileBrowser.upload.success' }));
        setUploadConfirmOpen(false);
        setPendingUploadFiles([]);
        setPendingUploadPath('');
        if (uploadPath === ensureDirectoryPath(currentPath)) {
          setSearchValue('');
          setIsSearching(false);
          setChildrenByPath({});
          await fetchList(currentPath);
          return;
        }
        const res: any = await listFiles({ resourceId, path: uploadPath });
        setChildrenByPath((prev) => ({
          ...prev,
          [uploadPath]: unwrapListResponse<FileBrowserItem>(res),
        }));
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.upload.failed' }));
      } finally {
        setUploadingFiles(false);
      }
    },
    [currentPath, fetchList, intl, resourceId, uploadingFiles]
  );

  const handleUploadSelect = useCallback((targetPath: string, fileList: File[]) => {
    if (!fileList.length) return;
    setPendingUploadPath(ensureDirectoryPath(targetPath));
    setPendingUploadFiles(fileList);
    setUploadConfirmOpen(true);
  }, []);

  const handleCancelUploadConfirm = useCallback(() => {
    if (uploadingFiles) return;
    setUploadConfirmOpen(false);
    setPendingUploadFiles([]);
    setPendingUploadPath('');
  }, [uploadingFiles]);

  const previewUploadFiles = pendingUploadFiles.slice(0, 3);
  const remainingUploadFileCount = pendingUploadFiles.length - previewUploadFiles.length;

  const loadTreeNode = useCallback(
    async (node: FileTreeItem) => {
      if (!isDirectory(node)) return;
      const path = ensureDirectoryPath(node.path);
      if (childrenByPath[path]) return;
      try {
        const res: any = await listFiles({ resourceId, path });
        setChildrenByPath((prev) => ({
          ...prev,
          [path]: unwrapListResponse<FileBrowserItem>(res),
        }));
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.error.loadFailed' }));
      }
    },
    [childrenByPath, intl, resourceId]
  );

  const handleTreeNodeClick = useCallback(
    (event: React.MouseEvent, node: FileTreeItem) => {
      event.stopPropagation();
      clearClickTimer();
      clickTimerRef.current = window.setTimeout(() => {
        clickTimerRef.current = null;
        if (isDirectory(node)) {
          if (isSearching || getPathDepth(currentPath) === 0) {
            setSearchValue('');
            setIsSearching(false);
            setChildrenByPath({});
            setCurrentPath(ensureDirectoryPath(node.path));
          }
          return;
        }
        void handlePreview(node);
      }, 220);
    },
    [clearClickTimer, currentPath, handlePreview, isSearching]
  );

  const handleItemDoubleClick = useCallback(
    (item: FileBrowserItem) => {
      clearClickTimer();
      EventEmitter.emit('queryInput-insert-item', {
        item: normalizeReferenceItem(item, resourceId),
        type: isDirectory(item) ? DragType.folder : DragType.file,
      });
    },
    [EventEmitter, clearClickTimer, resourceId]
  );

  const openSaveToKnowledge = useCallback(
    (item: FileBrowserItem) => {
      clearClickTimer();
      setSaveTarget(item);
      setKnowledgeKeyword('');
      setSelectedKnowledgeBase(null);
      setKnowledgeDirectoryPath('/');
      setKnowledgeFolders([]);
      setSaveModalOpen(true);
      void loadKnowledgeBases('');
    },
    [clearClickTimer, loadKnowledgeBases]
  );

  const openCopyToFileBrowser = useCallback(
    (item: FileBrowserItem, targetType: FileCopyTargetType) => {
      clearClickTimer();
      const defaultPath = getCopyTargetPath(targetType, sessionId);
      setCopyTarget(item);
      setCopyTargetType(targetType);
      setCopyDirectoryPath(defaultPath);
      setCopyFolders([]);
      setCopyModalOpen(true);
      void loadCopyFolders(defaultPath);
    },
    [clearClickTimer, loadCopyFolders, sessionId]
  );

  const handleSelectKnowledgeBase = useCallback(
    (kb: IKnowledgeBaseItem) => {
      setSelectedKnowledgeBase(kb);
      void loadKnowledgeFolders(kb, '/');
    },
    [loadKnowledgeFolders]
  );

  const uploadFileToKnowledge = useCallback(
    async (item: FileBrowserItem, kb: IKnowledgeBaseItem, directoryPath: string) => {
      const res: any = await downloadFile(resourceId, item.path);
      const rawBlob = getRawBlob(res);
      const mimeType = rawBlob.type || getMimeType(item.name) || undefined;
      const file = new File([rawBlob], item.name, mimeType ? { type: mimeType } : undefined);
      const formData = new FormData();
      formData.append('resourceId', String(kb.resourceId));
      formData.append('directoryPath', directoryPath);
      formData.append('overwrite', 'true');
      formData.append('files', file);
      await uploadKnowledgeFiles(formData);
    },
    [resourceId]
  );

  const ensureKnowledgeFolder = useCallback(
    async (kb: IKnowledgeBaseItem, parentDirectoryPath: string, folderName: string) => {
      try {
        await createKnowledgeFolder({
          resourceId: Number(kb.resourceId),
          directoryName: folderName,
          directoryPath: parentDirectoryPath,
          directoryDescription: '',
        });
      } catch (error) {
        const response = await queryDirAndFileByLevel({
          resourceId: Number(kb.resourceId),
          directoryPath: parentDirectoryPath,
        });
        const existed = unwrapListResponse<QueryDirAndFileByLevelItem>(response).some(
          (item) => item.type === 'directory' && item.name === folderName
        );
        if (!existed) {
          throw error;
        }
      }
    },
    []
  );

  const copyFileBrowserDirectoryToKnowledge = useCallback(
    async function copyDirectory(
      item: FileBrowserItem,
      kb: IKnowledgeBaseItem,
      parentDirectoryPath: string
    ): Promise<void> {
      const targetDirectoryPath = joinKnowledgeDirectoryPath(parentDirectoryPath, item.name);
      await ensureKnowledgeFolder(kb, parentDirectoryPath, item.name);

      const response = await listFiles({ resourceId, path: ensureDirectoryPath(item.path) });
      const children = unwrapListResponse<FileBrowserItem>(response);
      for (const child of children) {
        if (isDirectory(child)) {
          await copyDirectory(child, kb, targetDirectoryPath);
        } else {
          await uploadFileToKnowledge(child, kb, targetDirectoryPath);
        }
      }
    },
    [ensureKnowledgeFolder, resourceId, uploadFileToKnowledge]
  );

  const handleConfirmSaveToKnowledge = useCallback(async () => {
    if (!saveTarget) return;
    if (!selectedKnowledgeBase) {
      message.warning(intl.formatMessage({ id: 'multiChoices.saveToKnowledge.selectKb' }));
      return;
    }

    setSavingToKnowledge(true);
    try {
      if (isDirectory(saveTarget)) {
        await copyFileBrowserDirectoryToKnowledge(saveTarget, selectedKnowledgeBase, knowledgeDirectoryPath);
      } else {
        await uploadFileToKnowledge(saveTarget, selectedKnowledgeBase, knowledgeDirectoryPath);
      }
      message.success(intl.formatMessage({ id: 'multiChoices.saveToKnowledge.success' }));
      setSaveModalOpen(false);
      setSaveTarget(null);
    } catch (error: any) {
      message.error(error?.message || intl.formatMessage({ id: 'fileSider.saveToKnowledge.failed' }));
    } finally {
      setSavingToKnowledge(false);
    }
  }, [
    copyFileBrowserDirectoryToKnowledge,
    intl,
    knowledgeDirectoryPath,
    message,
    saveTarget,
    selectedKnowledgeBase,
    uploadFileToKnowledge,
  ]);

  const handleConfirmCopyToFileBrowser = useCallback(async () => {
    if (!copyTarget) return;
    setCopyingToFileBrowser(true);
    try {
      await copyFile({
        resourceId,
        sourcePath: isDirectory(copyTarget) ? ensureDirectoryPath(copyTarget.path) : copyTarget.path,
        targetDirectory: copyDirectoryPath,
      });
      message.success(intl.formatMessage({ id: 'fileBrowser.copy.success' }));
      setCopyModalOpen(false);
      setCopyTarget(null);
      setChildrenByPath({});
      if (copyDirectoryPath === ensureDirectoryPath(currentPath)) {
        await fetchList(currentPath);
      }
    } catch (error: any) {
      message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.copy.failed' }));
    } finally {
      setCopyingToFileBrowser(false);
    }
  }, [copyDirectoryPath, copyTarget, currentPath, fetchList, intl, resourceId]);

  useEffect(() => {
    return clearClickTimer;
  }, [clearClickTimer]);

  const getFileActionItems = useCallback(
    (item: FileTreeItem) => {
      const dir = isDirectory(item);
      const actionScope = getFileActionScope(activeCategoryKey, item);
      const extraActions: FileActionKey[] = [];
      const isRootCategoryTopLevelDirectory = activeCategoryKey === 'root' && dir && getPathDepth(item.path) === 1;
      if (!isRootCategoryTopLevelDirectory) {
        if (actionScope === 'bykc') {
          extraActions.push('saveToSessionFiles', 'saveToSharedFiles');
        } else if (actionScope === 'session') {
          extraActions.push('saveToKnowledge', 'saveToSharedFiles');
        } else if (actionScope === 'shared' || actionScope === 'log') {
          extraActions.push('saveToKnowledge', 'saveToSessionFiles');
        }
      }

      const actionKeys: FileActionKey[] = [
        ...(dir ? (['upload'] as FileActionKey[]) : []),
        'download',
        ...extraActions,
      ];

      return actionKeys.map((key) => {
        if (key === 'upload') {
          return {
            key,
            label: (
              <Upload
                showUploadList={false}
                multiple
                beforeUpload={(_, fileList) => {
                  handleUploadSelect(item.path, fileList as unknown as File[]);
                  return false;
                }}
              >
                <div className={employeeStyles.dropdownMenuItem}>
                  {intl.formatMessage({ id: 'fileBrowser.toolbar.upload' })}
                </div>
              </Upload>
            ),
          };
        }
        const labelIdMap: Record<FileActionKey, string> = {
          upload: 'fileBrowser.toolbar.upload',
          download: 'directoryManage.downloadFile',
          saveToKnowledge: 'fileSider.saveToKnowledge',
          saveToSessionFiles: 'fileBrowser.save.toSessionFiles',
          saveToSharedFiles: 'fileBrowser.save.toSharedFiles',
        };
        return {
          key,
          label: <div className={employeeStyles.dropdownMenuItem}>{intl.formatMessage({ id: labelIdMap[key] })}</div>,
        };
      });
    },
    [activeCategoryKey, handleUploadSelect, intl]
  );

  const fileTreeContent = (
    <div className={styles.categoryBody}>
      <div className={styles.breadcrumbBar}>
        {isSearching ? (
          <span className={styles.searchResult}>{searchValue}</span>
        ) : (
          <KnowledgeBreadcrumb folderPath={folderPath} handleBreadcrumbClick={handleBreadcrumbClick} />
        )}
      </div>
      <Spin spinning={loading} wrapperClassName={styles.listSpin}>
        <div className={styles.treeScroll}>
          {fileTreeData.length ? (
            <Tree.DirectoryTree
              showIcon
              selectable={false}
              treeData={fileTreeData}
              loadData={(node) => loadTreeNode(node as unknown as FileTreeItem)}
              icon={(node) => {
                const item = node as unknown as FileTreeItem;
                return (
                  <Tooltip title={item.name} placement="right">
                    <span>
                      <AntdIcon type={`icon-${getIconType(item.name, isDirectory(item))}`} />
                    </span>
                  </Tooltip>
                );
              }}
              className={`${commonStyles.tree} ${styles.fileTree}`}
              onClick={handleTreeNodeClick as any}
              onDoubleClick={(_, node) => handleItemDoubleClick(node as unknown as FileTreeItem)}
              titleRender={(item) => (
                <Tooltip title={item.name} placement="right">
                  <span className={styles.treeTitleContent}>
                    <span className={styles.treeTitleText}>{item.name}</span>
                    <Dropdown
                      trigger={['hover']}
                      overlayClassName={employeeStyles.mydropdown}
                      menu={{
                        items: getFileActionItems(item as FileTreeItem),
                        onClick: ({ key, domEvent }) => {
                          domEvent.stopPropagation();
                          if (key === 'download') {
                            void handleDownload(item as FileTreeItem);
                          } else if (key === 'saveToKnowledge') {
                            openSaveToKnowledge(item as FileTreeItem);
                          } else if (key === 'saveToSessionFiles') {
                            openCopyToFileBrowser(item as FileTreeItem, 'session');
                          } else if (key === 'saveToSharedFiles') {
                            openCopyToFileBrowser(item as FileTreeItem, 'shared');
                          }
                        },
                      }}
                    >
                      <EllipsisOutlined
                        className={commonStyles.treeActionIcon}
                        onClick={(event) => event.stopPropagation()}
                        onMouseDown={(event) => event.stopPropagation()}
                      />
                    </Dropdown>
                  </span>
                </Tooltip>
              )}
            />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={intl.formatMessage({ id: 'fileBrowser.empty' })} />
          )}
        </div>
      </Spin>
    </div>
  );

  return (
    <div className={styles.miniList}>
      <Input
        allowClear
        value={searchValue}
        suffix={<SearchOutlined onClick={() => handleSearch(searchValue)} />}
        placeholder={intl.formatMessage({ id: 'fileBrowser.toolbar.search' })}
        onChange={(event) => setSearchValue(event.target.value)}
        onPressEnter={() => handleSearch(searchValue)}
      />
      <Collapse
        accordion
        activeKey={activeCategoryKey}
        onChange={handleCategoryChange}
        className={styles.categoryCollapse}
        items={fileCategories.map((category) => ({
          key: category.key,
          className: category.key === activeCategoryKey ? styles.categoryItemActive : undefined,
          label: (
            <div
              className={[styles.categoryHeader, category.key === activeCategoryKey ? styles.categoryHeaderActive : '']
                .filter(Boolean)
                .join(' ')}
            >
              <span className={styles.categoryTitle}>{intl.formatMessage({ id: category.titleId })}</span>
              <span className={styles.categoryPath}>{category.path}</span>
            </div>
          ),
          children: category.key === activeCategoryKey ? fileTreeContent : null,
        }))}
      />
      <Modal
        title={intl.formatMessage({ id: 'knowledgeDetail.uploadConfirmTitle' })}
        open={uploadConfirmOpen}
        okText={intl.formatMessage({ id: 'fileBrowser.toolbar.upload' })}
        cancelText={intl.formatMessage({ id: 'common.cancel' })}
        confirmLoading={uploadingFiles}
        onOk={() => executeUpload(pendingUploadPath, pendingUploadFiles)}
        onCancel={handleCancelUploadConfirm}
        destroyOnClose
        width="50vw"
        style={{ minWidth: 640, maxWidth: 960 }}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Space
            direction="vertical"
            size={12}
            style={{
              width: '100%',
              padding: 16,
              border: '1px solid #f0f0f0',
              borderRadius: 10,
              background: '#fafafa',
            }}
          >
            <Typography.Text strong>{intl.formatMessage({ id: 'knowledgeDetail.uploadInfo' })}</Typography.Text>
            <div style={{ display: 'grid', gridTemplateColumns: '86px minmax(0, 1fr)', rowGap: 8, columnGap: 12 }}>
              <Typography.Text type="secondary">
                {intl.formatMessage({ id: 'knowledgeDetail.uploadDirectory' })}
              </Typography.Text>
              <Typography.Text ellipsis style={{ maxWidth: '100%' }}>
                {pendingUploadPath || '/'}
              </Typography.Text>
              <Typography.Text type="secondary">
                {intl.formatMessage({ id: 'knowledgeDetail.selectedFiles' })}
              </Typography.Text>
              <Typography.Text>
                {intl.formatMessage({ id: 'knowledgeDetail.uploadConfirmFiles' }, { count: pendingUploadFiles.length })}
              </Typography.Text>
            </div>

            <div style={{ width: '100%', padding: 12, borderRadius: 10, background: '#fff' }}>
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Typography.Text strong>{intl.formatMessage({ id: 'knowledgeDetail.fileList' })}</Typography.Text>
                <Space direction="vertical" size={6} style={{ width: '100%' }}>
                  {previewUploadFiles.map((file) => (
                    <div
                      key={`${file.name}-${file.size}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        padding: '8px 10px',
                        borderRadius: 8,
                        background: '#f7f8fa',
                      }}
                    >
                      <Typography.Text ellipsis style={{ flex: 1, maxWidth: '100%' }}>
                        {file.name}
                      </Typography.Text>
                      <Typography.Text type="secondary" style={{ flex: 'none', fontSize: 12 }}>
                        {formatFileSize(file.size)}
                      </Typography.Text>
                    </div>
                  ))}
                </Space>
                {remainingUploadFileCount > 0 && (
                  <Typography.Text type="secondary">
                    {intl.formatMessage(
                      { id: 'knowledgeDetail.uploadConfirmMoreFiles' },
                      { count: remainingUploadFileCount }
                    )}
                  </Typography.Text>
                )}
              </Space>
            </div>
          </Space>
        </Space>
      </Modal>
      <Modal
        open={copyModalOpen}
        title={intl.formatMessage({
          id: copyTargetType === 'session' ? 'fileBrowser.copy.toSessionTitle' : 'fileBrowser.copy.toSharedTitle',
        })}
        okText={intl.formatMessage({ id: 'common.confirm' })}
        cancelText={intl.formatMessage({ id: 'common.cancel' })}
        confirmLoading={copyingToFileBrowser}
        onOk={handleConfirmCopyToFileBrowser}
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
            {copyTarget?.name}
          </Typography.Text>
          <Typography.Text>
            {intl.formatMessage({ id: 'fileBrowser.copy.targetDirectory' })}
            {copyDirectoryPath}
          </Typography.Text>
          <KnowledgeBreadcrumb
            folderPath={copyFolderPath}
            handleBreadcrumbClick={(index) => {
              const target = copyFolderPath[index];
              if (target) {
                void loadCopyFolders(target.id);
              }
            }}
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
      <Modal
        open={saveModalOpen}
        title={intl.formatMessage({ id: 'fileSider.saveToKnowledge' })}
        okText={intl.formatMessage({ id: 'common.confirm' })}
        cancelText={intl.formatMessage({ id: 'common.cancel' })}
        confirmLoading={savingToKnowledge}
        okButtonProps={{ disabled: !selectedKnowledgeBase }}
        onOk={handleConfirmSaveToKnowledge}
        onCancel={() => {
          if (savingToKnowledge) return;
          setSaveModalOpen(false);
          setSaveTarget(null);
        }}
        destroyOnClose
      >
        {!selectedKnowledgeBase ? (
          <>
            <Input.Search
              allowClear
              value={knowledgeKeyword}
              placeholder={intl.formatMessage({ id: 'multiChoices.saveToKnowledge.searchPlaceholder' })}
              onChange={(event) => setKnowledgeKeyword(event.target.value)}
              onSearch={() => loadKnowledgeBases()}
              style={{ marginBottom: 12 }}
            />
            <Spin spinning={knowledgeLoading}>
              <List
                dataSource={knowledgeBases}
                locale={{ emptyText: intl.formatMessage({ id: 'multiChoices.saveToKnowledge.empty' }) }}
                renderItem={(kb) => (
                  <List.Item onClick={() => handleSelectKnowledgeBase(kb)} style={{ cursor: 'pointer' }}>
                    <List.Item.Meta
                      avatar={<AntdIcon type="icon-zhishi" />}
                      title={<Typography.Text>{kb.resourceName}</Typography.Text>}
                      description={kb.resourceDesc}
                    />
                  </List.Item>
                )}
              />
            </Spin>
          </>
        ) : (
          <>
            <Button
              size="small"
              style={{ marginBottom: 12 }}
              onClick={() => {
                setSelectedKnowledgeBase(null);
                setKnowledgeFolders([]);
                setKnowledgeDirectoryPath('/');
              }}
            >
              {intl.formatMessage({ id: 'fileSider.saveToKnowledge.backToList' })}
            </Button>
            <Typography.Paragraph strong ellipsis>
              {selectedKnowledgeBase.resourceName}
            </Typography.Paragraph>
            <KnowledgeBreadcrumb
              folderPath={knowledgeFolderPath}
              handleBreadcrumbClick={(index) => {
                const target = knowledgeFolderPath[index];
                if (target && selectedKnowledgeBase) {
                  void loadKnowledgeFolders(selectedKnowledgeBase, target.id);
                }
              }}
            />
            <Spin spinning={knowledgeFolderLoading}>
              <List
                dataSource={knowledgeFolders}
                locale={{ emptyText: intl.formatMessage({ id: 'fileSider.saveToKnowledge.rootTip' }) }}
                renderItem={(folder) => (
                  <List.Item
                    onClick={() => {
                      if (!selectedKnowledgeBase) return;
                      const nextPath =
                        String(folder.directoryPath ?? '').trim() ||
                        joinKnowledgeDirectoryPath(knowledgeDirectoryPath, folder.name);
                      void loadKnowledgeFolders(
                        selectedKnowledgeBase,
                        nextPath.startsWith('/') ? nextPath : `/${nextPath}`
                      );
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
          </>
        )}
      </Modal>
    </div>
  );
};

export default FileMiniList;
