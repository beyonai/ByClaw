import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Collapse,
  Button,
  Dropdown,
  Empty,
  Input,
  List,
  Modal,
  Space,
  Spin,
  Tree,
  Typography,
  Upload,
  message,
  Tooltip,
} from 'antd';
import { EllipsisOutlined, SearchOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import AntdIcon from '@/components/AntdIcon';
import KnowledgeBreadcrumb from '@/components/KnowledgeBreadcrumb';
import KnowledgeTargetSelector from '@/components/KnowledgeTargetSelector';
import UploadConfirmModal, { type UploadConfirmFile } from '@/components/UploadConfirmModal';
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
  createFolder as createFileBrowserFolder,
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
  checkUploadFileConflicts,
  createFolder as createKnowledgeFolder,
  queryDirAndFileByLevel,
  uploadFiles as uploadKnowledgeFiles,
  type QueryDirAndFileByLevelItem,
} from '@/service/knowledgeCenter';
import type { IKnowledgeBaseItem } from '@/layout/sider/components/Knowledge/components/KnowledgeBase/types';
import { getFileIconType } from '@/constants/icon';
import commonStyles from '../Knowledge/components/common.module.less';
import styles from './index.module.less';

const PreViewFile = React.lazy(() =>
  import('@/components/Preview/Twins').then((module) => ({ default: module.PreViewFile }))
);

function getIconType(name: string, isDir: boolean): string {
  return getFileIconType(name, {
    isDirectory: isDir,
    directoryIconType: 'wenjianjialanse',
  });
}

function isDirectory(item: FileBrowserItem) {
  return item.isDir || (item as any).dir;
}

function canPreviewFile(item: FileBrowserItem) {
  return !isDirectory(item) && isPreviewable(item.name);
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
type FileActionKey =
  | 'upload'
  | 'createFolder'
  | 'preview'
  | 'download'
  | 'saveToKnowledge'
  | 'saveToSessionFiles'
  | 'saveToSharedFiles';

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

function getCategoryRootPath(categoryKey: FileCategoryKey | undefined) {
  if (categoryKey === 'session') return SESSION_FILE_PATH;
  if (categoryKey === 'shared') return SHARED_FILE_PATH;
  if (categoryKey === 'log') return LOG_FILE_PATH;
  return ROOT_FILE_PATH;
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

function getParentDirectoryPath(path: string) {
  const normalizedPath = ensureDirectoryPath(normalizeFileBrowserPath(path));
  const segments = normalizedPath.split('/').filter(Boolean);
  if (segments.length <= 1) return ROOT_FILE_PATH;
  return `/${segments.slice(0, -1).join('/')}/`;
}

function isSameDirectoryLevel(path: string, targetPath: string) {
  const normalizedPath = ensureDirectoryPath(normalizeFileBrowserPath(path));
  const normalizedTargetPath = ensureDirectoryPath(normalizeFileBrowserPath(targetPath));
  return getParentDirectoryPath(normalizedPath) === getParentDirectoryPath(normalizedTargetPath);
}

function isAllowedUploadDirectoryTarget(path: string, basePath: string) {
  const normalizedPath = ensureDirectoryPath(normalizeFileBrowserPath(path));
  const normalizedBasePath = ensureDirectoryPath(normalizeFileBrowserPath(basePath || ROOT_FILE_PATH));
  if (normalizedPath === ROOT_FILE_PATH) return false;
  return (
    normalizedPath === normalizedBasePath ||
    isPathIn(normalizedPath, normalizedBasePath) ||
    isSameDirectoryLevel(normalizedPath, normalizedBasePath)
  );
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

function getBykcPathSegments(path: string) {
  const normalizedPath = ensureDirectoryPath(normalizeFileBrowserPath(path));
  if (!isPathIn(normalizedPath, BYKC_FILE_PATH)) return [];
  return normalizedPath.slice(BYKC_FILE_PATH.length).split('/').filter(Boolean);
}

function normalizeMatchToken(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

function getKnowledgeBaseMatchTokens(kb: IKnowledgeBaseItem) {
  const data = kb as any;
  return [
    data.resourceId,
    data.resourceCode,
    data.resourceName,
    data.collectionName,
    data.name,
    data.knCode,
    data.knowledgeCode,
    data.datasetId,
  ]
    .map(normalizeMatchToken)
    .filter(Boolean);
}

function buildKnowledgeDirectoryPath(segments: string[]) {
  return segments.length ? `/${segments.join('/')}/`.replace(/\/+/g, '/') : '/';
}

function resolveBykcKnowledgeUploadTarget(path: string, knowledgeBases: IKnowledgeBaseItem[]) {
  const segments = getBykcPathSegments(path);
  const firstSegment = normalizeMatchToken(segments[0]);
  if (!knowledgeBases.length) return null;

  if (firstSegment) {
    const matched = knowledgeBases.find((kb) => getKnowledgeBaseMatchTokens(kb).includes(firstSegment));
    if (matched) {
      return {
        knowledgeBase: matched,
        directoryPath: buildKnowledgeDirectoryPath(segments.slice(1)),
      };
    }
  }

  if (knowledgeBases.length === 1) {
    return {
      knowledgeBase: knowledgeBases[0],
      directoryPath: buildKnowledgeDirectoryPath(segments),
    };
  }

  return null;
}

interface PendingKnowledgeUpload extends UploadConfirmFile {
  source: FileBrowserItem;
  targetDirectoryPath: string;
}

interface FileCategoryCache {
  path: string;
  items: FileBrowserItem[];
  childrenByPath: Record<string, FileBrowserItem[]>;
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
  const categoryCacheRef = useRef<Partial<Record<FileCategoryKey, FileCategoryCache>>>({});
  const activeCategoryKeyRef = useRef<FileCategoryKey | undefined>('root');
  const currentPathRef = useRef('');
  const fetchListRequestSeqRef = useRef(0);
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
  const [uploadDirectoryPickerOpen, setUploadDirectoryPickerOpen] = useState(false);
  const [uploadDirectoryPath, setUploadDirectoryPath] = useState('/');
  const [uploadDirectoryBasePath, setUploadDirectoryBasePath] = useState('/');
  const [uploadDirectoryFolders, setUploadDirectoryFolders] = useState<FileBrowserItem[]>([]);
  const [uploadDirectoryLoading, setUploadDirectoryLoading] = useState(false);
  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const [copyTarget, setCopyTarget] = useState<FileBrowserItem | null>(null);
  const [copyTargetType, setCopyTargetType] = useState<FileCopyTargetType>('session');
  const [copyDirectoryPath, setCopyDirectoryPath] = useState('/');
  const [copyFolders, setCopyFolders] = useState<FileBrowserItem[]>([]);
  const [copyFolderLoading, setCopyFolderLoading] = useState(false);
  const [copyingToFileBrowser, setCopyingToFileBrowser] = useState(false);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [createFolderParentPath, setCreateFolderParentPath] = useState('');
  const [createFolderName, setCreateFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);

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
        path: SESSION_FILE_PATH,
        ensure: true,
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
  const [knowledgeUploadConfirmOpen, setKnowledgeUploadConfirmOpen] = useState(false);
  const [pendingKnowledgeUploads, setPendingKnowledgeUploads] = useState<PendingKnowledgeUpload[]>([]);
  const [pendingKnowledgeConflicts, setPendingKnowledgeConflicts] = useState<string[]>([]);
  const [pendingKnowledgeDirectoryPath, setPendingKnowledgeDirectoryPath] = useState('/');
  const [pendingKnowledgeBase, setPendingKnowledgeBase] = useState<IKnowledgeBaseItem | null>(null);

  const updateCategoryCache = useCallback(
    (categoryKey: FileCategoryKey | undefined, cache: Partial<FileCategoryCache> & Pick<FileCategoryCache, 'path'>) => {
      if (!categoryKey) return;
      const prev = categoryCacheRef.current[categoryKey];
      categoryCacheRef.current[categoryKey] = {
        path: cache.path,
        items: cache.items ?? prev?.items ?? [],
        childrenByPath: cache.childrenByPath ?? prev?.childrenByPath ?? {},
      };
    },
    []
  );

  const fetchList = useCallback(
    async (path: string, options: { force?: boolean; categoryKey?: FileCategoryKey | undefined } = {}) => {
      const cacheKey = options.categoryKey ?? activeCategoryKey;
      const categoryRootPath = getCategoryRootPath(cacheKey);
      const normalizedPath = ensureDirectoryPath(normalizeFileBrowserPath(path || categoryRootPath));
      const requestPath =
        cacheKey !== 'root' && !isPathIn(normalizedPath, categoryRootPath) ? categoryRootPath : normalizedPath;
      const cached = cacheKey ? categoryCacheRef.current[cacheKey] : undefined;
      if (!options.force && cached?.path === requestPath) {
        if (activeCategoryKeyRef.current === cacheKey && currentPathRef.current === requestPath) {
          setItems(cached.items);
          setChildrenByPath(cached.childrenByPath);
        }
        return;
      }
      const requestSeq = ++fetchListRequestSeqRef.current;
      setLoading(true);
      try {
        const res: any = await listFiles({ resourceId, path: requestPath });
        const data = res?.data ?? res ?? [];
        const nextItems = Array.isArray(data) ? data : [];
        const nextChildrenByPath = options.force ? {} : cached?.childrenByPath || {};
        updateCategoryCache(cacheKey, {
          path: requestPath,
          items: nextItems,
          childrenByPath: nextChildrenByPath,
        });
        if (
          requestSeq === fetchListRequestSeqRef.current &&
          activeCategoryKeyRef.current === cacheKey &&
          currentPathRef.current === requestPath
        ) {
          setItems(nextItems);
          setChildrenByPath(nextChildrenByPath);
        }
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.error.loadFailed' }));
      } finally {
        if (requestSeq === fetchListRequestSeqRef.current) {
          setLoading(false);
        }
      }
    },
    [activeCategoryKey, intl, resourceId, updateCategoryCache]
  );

  useEffect(() => {
    activeCategoryKeyRef.current = activeCategoryKey;
  }, [activeCategoryKey]);

  useEffect(() => {
    currentPathRef.current = currentPath;
  }, [currentPath]);

  useEffect(() => {
    const defaultCategoryKey = getDefaultFileCategoryKey(sessionId);
    const defaultCategoryPath = getCategoryRootPath(defaultCategoryKey);
    setPathInitialized(false);
    categoryCacheRef.current = {};
    activeCategoryKeyRef.current = defaultCategoryKey;
    currentPathRef.current = defaultCategoryPath;
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

      // 清除缓存，确保切换 tab 时强制刷新数据
      const cached = categoryCacheRef.current[nextCategory.key];
      delete categoryCacheRef.current[nextCategory.key];

      setActiveCategoryKey(nextCategory.key);
      setSearchValue('');
      setIsSearching(false);
      setItems([]);
      setChildrenByPath({});
      // ensureFolder 只在缓存不存在时调用（即首次访问）
      if (nextCategory.ensure && !cached) {
        try {
          await ensureFolder({ resourceId, path: nextCategory.path });
        } catch (error: any) {
          message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.createFolder.failed' }));
        }
      }
      activeCategoryKeyRef.current = nextCategory.key;
      currentPathRef.current = nextCategory.path;
      setCurrentPath(nextCategory.path);
    },
    [fileCategories, fetchList, intl, resourceId]
  );

  // 监听会话聊天产生的文件，当打开 session tab 时刷新文件列表
  useEffect(() => {
    const handleSessionFileCreated = (payload: { fileList?: any[]; imageList?: any[]; sessionId?: string }) => {
      // 如果当前打开的不是 session tab，不处理
      if (activeCategoryKey !== 'session') return;
      // 检查 payload 是否包含文件信息
      const hasFiles =
        (payload.fileList && payload.fileList.length > 0) || (payload.imageList && payload.imageList.length > 0);
      if (hasFiles) {
        // 刷新当前路径的文件列表
        delete categoryCacheRef.current['session'];
        void fetchList(currentPath, { force: true });
      }
    };

    EventEmitter.on('beyond-create-message', handleSessionFileCreated);
    return () => {
      EventEmitter.off('beyond-create-message', handleSessionFileCreated);
    };
  }, [activeCategoryKey, currentPath, fetchList]);

  const sortedItems = useMemo(() => {
    return sortFileBrowserItems(items);
  }, [items]);

  const fileTreeData = useMemo(() => {
    return toFileTreeData(sortedItems, childrenByPath);
  }, [childrenByPath, sortedItems]);

  const copyFolderPath = useMemo(() => {
    const rootPath = copyTargetType === 'session' ? SESSION_FILE_PATH : SHARED_FILE_PATH;
    return buildScopedFolderPath(copyDirectoryPath, rootPath);
  }, [copyDirectoryPath, copyTargetType]);

  const uploadDirectoryBrowseRootPath = useMemo(() => {
    return getParentDirectoryPath(uploadDirectoryBasePath || pendingUploadPath || currentPath || ROOT_FILE_PATH);
  }, [currentPath, pendingUploadPath, uploadDirectoryBasePath]);

  const uploadDirectoryBreadcrumb = useMemo(() => {
    return buildScopedFolderPath(uploadDirectoryPath, uploadDirectoryBrowseRootPath);
  }, [uploadDirectoryBrowseRootPath, uploadDirectoryPath]);

  const canConfirmUploadDirectory = useMemo(() => {
    return isAllowedUploadDirectoryTarget(uploadDirectoryPath, uploadDirectoryBasePath);
  }, [uploadDirectoryBasePath, uploadDirectoryPath]);

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
        const folders = unwrapListResponse<QueryDirAndFileByLevelItem>(response).filter(
          (item) => item.type === 'directory'
        );
        setKnowledgeFolders(folders);
        setKnowledgeDirectoryPath(directoryPath);
        return folders;
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.error.loadFailed' }));
        return [];
      } finally {
        setKnowledgeFolderLoading(false);
      }
    },
    [intl]
  );

  const loadKnowledgeFolderChildren = useCallback(
    async (kb: IKnowledgeBaseItem, directoryPath: string) => {
      try {
        const response = await queryDirAndFileByLevel({
          resourceId: Number(kb.resourceId),
          directoryPath,
        });
        return unwrapListResponse<QueryDirAndFileByLevelItem>(response).filter((item) => item.type === 'directory');
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.error.loadFailed' }));
        return [];
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

  const loadUploadDirectoryFolders = useCallback(
    async (directoryPath: string) => {
      const normalizedPath = ensureDirectoryPath(directoryPath || '/');
      setUploadDirectoryLoading(true);
      try {
        const response = await listFiles({ resourceId, path: normalizedPath });
        setUploadDirectoryFolders(unwrapListResponse<FileBrowserItem>(response).filter((item) => isDirectory(item)));
        setUploadDirectoryPath(normalizedPath);
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.error.loadFailed' }));
      } finally {
        setUploadDirectoryLoading(false);
      }
    },
    [intl, resourceId]
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
      if (!canPreviewFile(item)) {
        message.warning(intl.formatMessage({ id: 'fileBrowser.preview.unavailable' }));
        return;
      }

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
    [clearDetailPanel, intl, message, renderPreviewPanel, resourceId]
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

  const resolveKnowledgeUploadTarget = useCallback(
    async (targetPath: string) => {
      const response = await queryDigEmployeeManageKnowledgeResourceAuth({
        resourceId,
        pageNum: 1,
        pageSize: 100,
        keyword: '',
      });
      const rows = Array.isArray(response?.rows) ? response.rows : Array.isArray(response?.list) ? response.list : [];
      if (!rows.length) {
        message.warning(intl.formatMessage({ id: 'fileSider.saveToKnowledge.noManagePermission' }));
        return null;
      }
      const target = resolveBykcKnowledgeUploadTarget(targetPath, rows);
      if (!target) {
        message.warning(intl.formatMessage({ id: 'fileBrowser.upload.bykcTargetRequired' }));
      }
      return target;
    },
    [intl, resourceId]
  );

  const executeKnowledgeDirectoryUpload = useCallback(
    async (targetPath: string, fileList: File[], processFrontMatter: boolean) => {
      const target = await resolveKnowledgeUploadTarget(targetPath);
      if (!target) return;

      const formData = new FormData();
      fileList.forEach((file) => {
        formData.append('files', file);
      });
      formData.append('resourceId', String(target.knowledgeBase.resourceId));
      formData.append('directoryPath', target.directoryPath);
      formData.append('processFrontMatter', String(!processFrontMatter));
      formData.append('overwrite', 'false');

      await uploadKnowledgeFiles(formData);
      message.success(intl.formatMessage({ id: 'fileBrowser.upload.knowledgeBuildSuccess' }));
      setUploadConfirmOpen(false);
      setPendingUploadFiles([]);
      setPendingUploadPath('');

      if (isPathIn(currentPath, BYKC_FILE_PATH)) {
        setSearchValue('');
        setIsSearching(false);
        setChildrenByPath({});
        await fetchList(currentPath, { force: true });
      }
    },
    [currentPath, fetchList, intl, resolveKnowledgeUploadTarget]
  );

  const executeUpload = useCallback(
    async (targetPath: string, fileList: File[], processFrontMatter = false) => {
      if (!fileList.length || uploadingFiles) return;
      const uploadPath = ensureDirectoryPath(targetPath || currentPath || '/');
      setUploadingFiles(true);
      try {
        if (isPathIn(uploadPath, BYKC_FILE_PATH)) {
          await executeKnowledgeDirectoryUpload(uploadPath, fileList, processFrontMatter);
          return;
        }
        await uploadFiles(resourceId, uploadPath, fileList);
        message.success(intl.formatMessage({ id: 'fileBrowser.upload.success' }));
        setUploadConfirmOpen(false);
        setPendingUploadFiles([]);
        setPendingUploadPath('');
        if (uploadPath === ensureDirectoryPath(currentPath)) {
          setSearchValue('');
          setIsSearching(false);
          setChildrenByPath({});
          await fetchList(currentPath, { force: true });
          return;
        }
        const res: any = await listFiles({ resourceId, path: uploadPath });
        setChildrenByPath((prev) => {
          const nextChildrenByPath = {
            ...prev,
            [uploadPath]: unwrapListResponse<FileBrowserItem>(res),
          };
          if (!isSearching) {
            updateCategoryCache(activeCategoryKey, {
              path: currentPath,
              items,
              childrenByPath: nextChildrenByPath,
            });
          }
          return nextChildrenByPath;
        });
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.upload.failed' }));
      } finally {
        setUploadingFiles(false);
      }
    },
    [
      activeCategoryKey,
      currentPath,
      executeKnowledgeDirectoryUpload,
      fetchList,
      intl,
      isSearching,
      items,
      resourceId,
      updateCategoryCache,
      uploadingFiles,
    ]
  );

  const refreshFileBrowserDirectory = useCallback(
    async (directoryPath: string) => {
      const normalizedPath = ensureDirectoryPath(directoryPath || ROOT_FILE_PATH);
      if (isPathIn(normalizedPath, SHARED_FILE_PATH)) {
        delete categoryCacheRef.current.shared;
      }
      if (normalizedPath === ensureDirectoryPath(currentPath)) {
        setSearchValue('');
        setIsSearching(false);
        setChildrenByPath({});
        await fetchList(currentPath, { force: true });
        return;
      }
      const res: any = await listFiles({ resourceId, path: normalizedPath });
      const directoryChildren = unwrapListResponse<FileBrowserItem>(res);
      setChildrenByPath((prev) => {
        const nextChildrenByPath = {
          ...prev,
          [normalizedPath]: directoryChildren,
        };
        if (!isSearching) {
          updateCategoryCache(activeCategoryKey, {
            path: currentPath,
            items,
            childrenByPath: nextChildrenByPath,
          });
        }
        return nextChildrenByPath;
      });
    },
    [activeCategoryKey, currentPath, fetchList, isSearching, items, resourceId, updateCategoryCache]
  );

  const handleUploadSelect = useCallback((targetPath: string, fileList: File[]) => {
    if (!fileList.length) return;
    setPendingUploadPath(ensureDirectoryPath(targetPath));
    setPendingUploadFiles(fileList);
    setUploadConfirmOpen(true);
  }, []);

  const openUploadDirectoryPicker = useCallback(() => {
    const initialPath = ensureDirectoryPath(pendingUploadPath || currentPath || ROOT_FILE_PATH);
    setUploadDirectoryBasePath(initialPath);
    setUploadDirectoryPickerOpen(true);
    void loadUploadDirectoryFolders(initialPath);
  }, [currentPath, loadUploadDirectoryFolders, pendingUploadPath]);

  const handleConfirmUploadDirectory = useCallback(() => {
    if (!isAllowedUploadDirectoryTarget(uploadDirectoryPath, uploadDirectoryBasePath)) {
      message.warning(intl.formatMessage({ id: 'fileBrowser.upload.directoryScopeTip' }));
      return;
    }
    setPendingUploadPath(ensureDirectoryPath(uploadDirectoryPath || ROOT_FILE_PATH));
    setUploadDirectoryPickerOpen(false);
  }, [intl, uploadDirectoryBasePath, uploadDirectoryPath]);

  const handleCategoryUploadSelect = useCallback(
    async (category: FileCategoryItem, fileList: File[]) => {
      if (!fileList.length) return;
      try {
        if (category.key !== 'root') {
          await ensureFolder({ resourceId, path: category.path });
        }
        handleUploadSelect(category.path, fileList);
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.createFolder.failed' }));
      }
    },
    [handleUploadSelect, intl, resourceId]
  );

  const handleRefreshCategory = useCallback(
    async (category: FileCategoryItem) => {
      try {
        if (category.key !== 'root') {
          await ensureFolder({ resourceId, path: category.path });
        }
        delete categoryCacheRef.current[category.key];
        if (category.key === activeCategoryKey) {
          setSearchValue('');
          setIsSearching(false);
          setChildrenByPath({});
          await fetchList(currentPath, { force: true, categoryKey: category.key });
        }
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.error.loadFailed' }));
      }
    },
    [activeCategoryKey, currentPath, fetchList, intl, resourceId]
  );

  const openCreateFolder = useCallback((parentPath: string) => {
    setCreateFolderParentPath(ensureDirectoryPath(parentPath || ROOT_FILE_PATH));
    setCreateFolderName('');
    setCreateFolderOpen(true);
  }, []);

  const handleCreateFolder = useCallback(async () => {
    const folderName = createFolderName.trim();
    if (!folderName) return;
    if (/[\\/]/.test(folderName)) {
      message.warning(intl.formatMessage({ id: 'fileBrowser.createFolder.prompt' }));
      return;
    }
    const parentPath = ensureDirectoryPath(createFolderParentPath || currentPath || ROOT_FILE_PATH);
    setCreatingFolder(true);
    try {
      await ensureFolder({ resourceId, path: parentPath });
      await createFileBrowserFolder({
        resourceId,
        path: buildTargetFolderPath(parentPath, folderName),
      });
      message.success(intl.formatMessage({ id: 'fileBrowser.createFolder.success' }));
      setCreateFolderOpen(false);
      setCreateFolderName('');
      setCreateFolderParentPath('');
      await refreshFileBrowserDirectory(parentPath);
    } catch (error: any) {
      message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.createFolder.failed' }));
    } finally {
      setCreatingFolder(false);
    }
  }, [createFolderName, createFolderParentPath, currentPath, intl, refreshFileBrowserDirectory, resourceId]);

  const handleCancelUploadConfirm = useCallback(() => {
    if (uploadingFiles) return;
    setUploadConfirmOpen(false);
    setPendingUploadFiles([]);
    setPendingUploadPath('');
  }, [uploadingFiles]);

  const loadTreeNode = useCallback(
    async (node: FileTreeItem) => {
      if (!isDirectory(node)) return;
      const path = ensureDirectoryPath(node.path);
      const activeRootPath = getCategoryRootPath(activeCategoryKey);
      if (activeCategoryKey !== 'root' && !isPathIn(path, activeRootPath)) return;
      if (childrenByPath[path]) return;
      try {
        const res: any = await listFiles({ resourceId, path });
        setChildrenByPath((prev) => {
          const nextChildrenByPath = {
            ...prev,
            [path]: unwrapListResponse<FileBrowserItem>(res),
          };
          if (!isSearching) {
            updateCategoryCache(activeCategoryKey, {
              path: currentPath,
              items,
              childrenByPath: nextChildrenByPath,
            });
          }
          return nextChildrenByPath;
        });
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.error.loadFailed' }));
      }
    },
    [activeCategoryKey, childrenByPath, currentPath, intl, isSearching, items, resourceId, updateCategoryCache]
  );

  const handleTreeNodeClick = useCallback(
    (event: React.MouseEvent, node: FileTreeItem) => {
      event.stopPropagation();
      clearClickTimer();
      clickTimerRef.current = window.setTimeout(() => {
        clickTimerRef.current = null;
        if (isDirectory(node)) {
          return;
        }
        if (!canPreviewFile(node)) {
          message.warning(intl.formatMessage({ id: 'fileBrowser.preview.unavailable' }));
          return;
        }
        void handlePreview(node);
      }, 220);
    },
    [clearClickTimer, handlePreview, intl, message]
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
    async (
      item: FileBrowserItem,
      kb: IKnowledgeBaseItem,
      directoryPath: string,
      options: { processFrontMatter?: boolean; overwrite?: boolean } = {}
    ) => {
      const res: any = await downloadFile(resourceId, item.path);
      const rawBlob = getRawBlob(res);
      const mimeType = rawBlob.type || getMimeType(item.name) || undefined;
      const file = new File([rawBlob], item.name, mimeType ? { type: mimeType } : undefined);
      const formData = new FormData();
      formData.append('resourceId', String(kb.resourceId));
      formData.append('directoryPath', directoryPath);
      formData.append('files', file);
      formData.append('processFrontMatter', String(!options.processFrontMatter));
      formData.append('overwrite', String(Boolean(options.overwrite)));
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
      parentDirectoryPath: string,
      options: { processFrontMatter?: boolean; overwrite?: boolean } = {}
    ): Promise<void> {
      const targetDirectoryPath = joinKnowledgeDirectoryPath(parentDirectoryPath, item.name);
      await ensureKnowledgeFolder(kb, parentDirectoryPath, item.name);

      const response = await listFiles({ resourceId, path: ensureDirectoryPath(item.path) });
      const children = unwrapListResponse<FileBrowserItem>(response);
      for (const child of children) {
        if (isDirectory(child)) {
          await copyDirectory(child, kb, targetDirectoryPath, options);
        } else {
          await uploadFileToKnowledge(child, kb, targetDirectoryPath, options);
        }
      }
    },
    [ensureKnowledgeFolder, resourceId, uploadFileToKnowledge]
  );

  const collectKnowledgeUploads = useCallback(
    async function collectUploads(
      item: FileBrowserItem,
      parentDirectoryPath: string
    ): Promise<PendingKnowledgeUpload[]> {
      if (!isDirectory(item)) {
        return [
          {
            source: item,
            targetDirectoryPath: parentDirectoryPath,
            name: item.name,
            size: item.size,
          },
        ];
      }

      const targetDirectoryPath = joinKnowledgeDirectoryPath(parentDirectoryPath, item.name);
      const response = await listFiles({ resourceId, path: ensureDirectoryPath(item.path) });
      const children = unwrapListResponse<FileBrowserItem>(response);
      const result: PendingKnowledgeUpload[] = [];
      for (const child of children) {
        const childUploads = await collectUploads(child, targetDirectoryPath);
        result.push(...childUploads);
      }
      return result;
    },
    [resourceId]
  );

  const checkKnowledgeUploadConflicts = useCallback(
    async (kb: IKnowledgeBaseItem, uploads: PendingKnowledgeUpload[]) => {
      const groups = uploads.reduce<Record<string, string[]>>((acc, item) => {
        if (!acc[item.targetDirectoryPath]) {
          acc[item.targetDirectoryPath] = [];
        }
        acc[item.targetDirectoryPath].push(item.name);
        return acc;
      }, {});

      const conflicts: string[] = [];
      for (const [directoryPath, fileNames] of Object.entries(groups)) {
        const response = await checkUploadFileConflicts({
          resourceId: kb.resourceId,
          directoryPath,
          fileNames,
        });
        conflicts.push(...(response?.overwritePaths || []));
      }
      return conflicts;
    },
    []
  );

  const handleConfirmSaveToKnowledge = useCallback(async () => {
    if (!saveTarget) return;
    if (!selectedKnowledgeBase) {
      message.warning(intl.formatMessage({ id: 'multiChoices.saveToKnowledge.selectKb' }));
      return;
    }

    setSavingToKnowledge(true);
    try {
      const uploads = await collectKnowledgeUploads(saveTarget, knowledgeDirectoryPath);
      const conflicts = await checkKnowledgeUploadConflicts(selectedKnowledgeBase, uploads);
      setPendingKnowledgeBase(selectedKnowledgeBase);
      setPendingKnowledgeDirectoryPath(knowledgeDirectoryPath);
      setPendingKnowledgeUploads(uploads);
      setPendingKnowledgeConflicts(conflicts);
      setSaveModalOpen(false);
      setKnowledgeUploadConfirmOpen(true);
    } catch (error: any) {
      message.error(error?.message || intl.formatMessage({ id: 'fileSider.saveToKnowledge.failed' }));
    } finally {
      setSavingToKnowledge(false);
    }
  }, [
    checkKnowledgeUploadConflicts,
    collectKnowledgeUploads,
    intl,
    knowledgeDirectoryPath,
    saveTarget,
    selectedKnowledgeBase,
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
      delete categoryCacheRef.current[copyTargetType];
      setChildrenByPath({});
      if (copyDirectoryPath === ensureDirectoryPath(currentPath)) {
        await fetchList(currentPath, { force: true });
      }
    } catch (error: any) {
      message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.copy.failed' }));
    } finally {
      setCopyingToFileBrowser(false);
    }
  }, [copyDirectoryPath, copyTarget, copyTargetType, currentPath, fetchList, intl, resourceId]);

  const handleConfirmKnowledgeUpload = useCallback(
    async (processFrontMatter: boolean) => {
      if (!saveTarget || !pendingKnowledgeBase) return;
      const overwrite = pendingKnowledgeConflicts.length > 0;
      setSavingToKnowledge(true);
      try {
        if (isDirectory(saveTarget)) {
          await copyFileBrowserDirectoryToKnowledge(saveTarget, pendingKnowledgeBase, pendingKnowledgeDirectoryPath, {
            processFrontMatter,
            overwrite,
          });
        } else {
          await uploadFileToKnowledge(saveTarget, pendingKnowledgeBase, pendingKnowledgeDirectoryPath, {
            processFrontMatter,
            overwrite,
          });
        }
        message.success(intl.formatMessage({ id: 'multiChoices.saveToKnowledge.success' }));
        setKnowledgeUploadConfirmOpen(false);
        setPendingKnowledgeUploads([]);
        setPendingKnowledgeConflicts([]);
        setPendingKnowledgeBase(null);
        setPendingKnowledgeDirectoryPath('/');
        setSaveModalOpen(false);
        setSaveTarget(null);
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileSider.saveToKnowledge.failed' }));
      } finally {
        setSavingToKnowledge(false);
      }
    },
    [
      copyFileBrowserDirectoryToKnowledge,
      intl,
      pendingKnowledgeBase,
      pendingKnowledgeConflicts.length,
      pendingKnowledgeDirectoryPath,
      saveTarget,
      uploadFileToKnowledge,
    ]
  );

  const handleCancelKnowledgeUpload = useCallback(() => {
    if (savingToKnowledge) return;
    setKnowledgeUploadConfirmOpen(false);
    setPendingKnowledgeUploads([]);
    setPendingKnowledgeConflicts([]);
    setPendingKnowledgeBase(null);
    setPendingKnowledgeDirectoryPath('/');
    setSaveTarget(null);
  }, [savingToKnowledge]);

  const isKnowledgeUploadConfirm = knowledgeUploadConfirmOpen;
  const isBykcUploadConfirm =
    !isKnowledgeUploadConfirm && Boolean(pendingUploadPath) && isPathIn(pendingUploadPath, BYKC_FILE_PATH);
  const uploadConfirmFiles: UploadConfirmFile[] = isKnowledgeUploadConfirm
    ? pendingKnowledgeUploads
    : pendingUploadFiles;
  const uploadConfirmDirectoryPath = isKnowledgeUploadConfirm
    ? pendingKnowledgeDirectoryPath
    : pendingUploadPath || '/';
  const uploadConfirmConflicts = isKnowledgeUploadConfirm ? pendingKnowledgeConflicts : [];
  const uploadConfirmLoading = isKnowledgeUploadConfirm ? savingToKnowledge : uploadingFiles;
  let uploadConfirmOkText = intl.formatMessage({ id: 'fileBrowser.toolbar.upload' });
  if (isKnowledgeUploadConfirm) {
    const okTextId = pendingKnowledgeConflicts.length
      ? 'knowledgeDetail.confirmOverwriteUpload'
      : 'knowledgeDetail.uploadFile';
    uploadConfirmOkText = intl.formatMessage({ id: okTextId });
  } else if (isBykcUploadConfirm) {
    uploadConfirmOkText = intl.formatMessage({ id: 'knowledgeDetail.uploadFile' });
  }

  const handleUploadConfirmOk = useCallback(
    (processFrontMatter: boolean) => {
      if (isKnowledgeUploadConfirm) {
        void handleConfirmKnowledgeUpload(processFrontMatter);
        return;
      }
      void executeUpload(pendingUploadPath, pendingUploadFiles, processFrontMatter);
    },
    [executeUpload, handleConfirmKnowledgeUpload, isKnowledgeUploadConfirm, pendingUploadFiles, pendingUploadPath]
  );

  const handleUploadConfirmCancel = useCallback(() => {
    if (isKnowledgeUploadConfirm) {
      handleCancelKnowledgeUpload();
      return;
    }
    handleCancelUploadConfirm();
  }, [handleCancelKnowledgeUpload, handleCancelUploadConfirm, isKnowledgeUploadConfirm]);

  useEffect(() => {
    return clearClickTimer;
  }, [clearClickTimer]);

  const renderCategoryActions = useCallback(
    (category: FileCategoryItem) => {
      const canManageCategory = category.key !== 'log';
      const uploadTitle = intl.formatMessage({ id: 'fileBrowser.toolbar.upload' });
      const createTitle = intl.formatMessage({ id: 'fileBrowser.toolbar.newFolder' });
      const refreshTitle = intl.formatMessage({ id: 'fileBrowser.toolbar.refresh' });

      return (
        <span className={styles.categoryActions} onClick={(event) => event.stopPropagation()}>
          {canManageCategory && (
            <Upload
              showUploadList={false}
              multiple
              beforeUpload={(_, fileList) => {
                void handleCategoryUploadSelect(category, fileList as unknown as File[]);
                return false;
              }}
            >
              <Button
                icon={<AntdIcon type="icon-a-Uploadshangchuan" className={styles.categoryActionIcon} />}
                size="small"
                className={styles.categoryActionButton}
                title={uploadTitle}
                aria-label={uploadTitle}
              />
            </Upload>
          )}
          {canManageCategory && (
            <Button
              icon={<AntdIcon type="icon-a-Folder-pluswenjianjia-tianjia" className={styles.categoryActionIcon} />}
              size="small"
              className={styles.categoryActionButton}
              title={createTitle}
              aria-label={createTitle}
              onClick={(event) => {
                event.stopPropagation();
                openCreateFolder(category.path);
              }}
            />
          )}
          <Button
            icon={<AntdIcon type="icon-a-Refreshshuaxin1" className={styles.categoryActionIcon} />}
            size="small"
            className={styles.categoryActionButton}
            title={refreshTitle}
            aria-label={refreshTitle}
            onClick={(event) => {
              event.stopPropagation();
              void handleRefreshCategory(category);
            }}
          />
        </span>
      );
    },
    [handleCategoryUploadSelect, handleRefreshCategory, intl, openCreateFolder]
  );

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
        ...(dir ? (['upload', 'createFolder'] as FileActionKey[]) : []),
        ...(canPreviewFile(item) ? (['preview'] as FileActionKey[]) : []),
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
          createFolder: 'common.create',
          preview: 'fileBrowser.action.preview',
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
              titleRender={(item) => {
                const cursor = canPreviewFile(item as FileTreeItem) ? 'pointer' : 'default';

                return (
                  <span className={styles.treeTitleContent}>
                    <Tooltip title={item.name} placement="right">
                      <span className={styles.treeTitleName} style={{ cursor }}>
                        <span className={styles.treeTitleText} style={{ cursor }}>
                          {item.name}
                        </span>
                      </span>
                    </Tooltip>
                    <Dropdown
                      trigger={['hover']}
                      overlayClassName={employeeStyles.mydropdown}
                      menu={{
                        items: getFileActionItems(item as FileTreeItem),
                        onClick: ({ key, domEvent }) => {
                          domEvent.stopPropagation();
                          if (key === 'preview') {
                            void handlePreview(item as FileTreeItem);
                          } else if (key === 'download') {
                            void handleDownload(item as FileTreeItem);
                          } else if (key === 'createFolder') {
                            openCreateFolder(ensureDirectoryPath((item as FileTreeItem).path));
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
                      <span
                        className={`${commonStyles.treeActionIcon} ${styles.treeActionTrigger}`}
                        onClick={(event) => event.stopPropagation()}
                        onMouseDown={(event) => event.stopPropagation()}
                      >
                        <EllipsisOutlined />
                      </span>
                    </Dropdown>
                  </span>
                );
              }}
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
              <div
                className={[styles.categoryHeaderMain, styles.categoryHeaderMainWithActions].filter(Boolean).join(' ')}
              >
                <span className={styles.categoryTitle}>{intl.formatMessage({ id: category.titleId })}</span>
                {renderCategoryActions(category)}
              </div>
              <span className={styles.categoryPath}>{category.path}</span>
            </div>
          ),
          children: category.key === activeCategoryKey ? fileTreeContent : null,
        }))}
      />
      <UploadConfirmModal
        open={uploadConfirmOpen || knowledgeUploadConfirmOpen}
        files={uploadConfirmFiles}
        directoryPath={uploadConfirmDirectoryPath}
        conflicts={uploadConfirmConflicts}
        loading={uploadConfirmLoading}
        showProcessFrontMatter={isKnowledgeUploadConfirm || isBykcUploadConfirm}
        okText={uploadConfirmOkText}
        directoryActionText={intl.formatMessage({ id: 'fileBrowser.upload.changeDirectory' })}
        onDirectoryAction={isKnowledgeUploadConfirm ? undefined : openUploadDirectoryPicker}
        onOk={handleUploadConfirmOk}
        onCancel={handleUploadConfirmCancel}
      />
      <Modal
        open={createFolderOpen}
        title={intl.formatMessage({ id: 'fileBrowser.toolbar.newFolder' })}
        okText={intl.formatMessage({ id: 'common.confirm' })}
        cancelText={intl.formatMessage({ id: 'common.cancel' })}
        confirmLoading={creatingFolder}
        onOk={handleCreateFolder}
        onCancel={() => {
          if (creatingFolder) return;
          setCreateFolderOpen(false);
          setCreateFolderParentPath('');
          setCreateFolderName('');
        }}
        destroyOnClose
      >
        <Input
          value={createFolderName}
          placeholder={intl.formatMessage({ id: 'fileBrowser.createFolder.prompt' })}
          onChange={(event) => setCreateFolderName(event.target.value)}
          onPressEnter={handleCreateFolder}
          maxLength={100}
        />
      </Modal>
      <Modal
        open={uploadDirectoryPickerOpen}
        title={intl.formatMessage({ id: 'fileBrowser.upload.selectDirectoryTitle' })}
        okText={intl.formatMessage({ id: 'common.confirm' })}
        cancelText={intl.formatMessage({ id: 'common.cancel' })}
        confirmLoading={uploadDirectoryLoading}
        okButtonProps={{ disabled: !canConfirmUploadDirectory }}
        onOk={handleConfirmUploadDirectory}
        onCancel={() => {
          if (uploadDirectoryLoading) return;
          setUploadDirectoryPickerOpen(false);
          setUploadDirectoryBasePath('/');
        }}
        zIndex={1001}
        destroyOnClose
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Typography.Text>
            {intl.formatMessage({ id: 'fileBrowser.copy.targetDirectory' })}
            {uploadDirectoryPath}
          </Typography.Text>
          <Typography.Text type="secondary">
            {intl.formatMessage({ id: 'fileBrowser.upload.directoryScopeTip' })}
          </Typography.Text>
          <KnowledgeBreadcrumb
            folderPath={uploadDirectoryBreadcrumb}
            handleBreadcrumbClick={(index) => {
              const target = uploadDirectoryBreadcrumb[index];
              if (target) {
                void loadUploadDirectoryFolders(target.id);
              }
            }}
          />
          <Spin spinning={uploadDirectoryLoading}>
            <List
              dataSource={uploadDirectoryFolders}
              locale={{ emptyText: intl.formatMessage({ id: 'fileBrowser.copy.noSubFolder' }) }}
              renderItem={(folder) => (
                <List.Item
                  onClick={() => {
                    const targetPath = buildTargetFolderPath(uploadDirectoryPath, folder.name);
                    if (!isAllowedUploadDirectoryTarget(targetPath, uploadDirectoryBasePath)) {
                      message.warning(intl.formatMessage({ id: 'fileBrowser.upload.directoryScopeTip' }));
                      return;
                    }
                    void loadUploadDirectoryFolders(targetPath);
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
      <KnowledgeTargetSelector
        open={saveModalOpen}
        onOk={handleConfirmSaveToKnowledge}
        onCancel={() => {
          if (savingToKnowledge) return;
          setSaveModalOpen(false);
          setSaveTarget(null);
        }}
        confirmLoading={savingToKnowledge}
        okDisabled={!selectedKnowledgeBase}
        keyword={knowledgeKeyword}
        onKeywordChange={setKnowledgeKeyword}
        onSearch={(keyword) => loadKnowledgeBases(keyword)}
        knowledgeBases={knowledgeBases}
        knowledgeLoading={knowledgeLoading}
        selectedKnowledgeBase={selectedKnowledgeBase}
        onSelectKnowledgeBase={(kb) => handleSelectKnowledgeBase(kb as IKnowledgeBaseItem)}
        directoryPath={knowledgeDirectoryPath}
        folders={knowledgeFolders}
        folderLoading={knowledgeFolderLoading}
        onFolderClick={(_, directoryPath) => {
          if (selectedKnowledgeBase) {
            void loadKnowledgeFolders(selectedKnowledgeBase, directoryPath);
          }
        }}
        onLoadFolderChildren={(directoryPath) => {
          if (selectedKnowledgeBase) {
            return loadKnowledgeFolderChildren(selectedKnowledgeBase, directoryPath);
          }
          return Promise.resolve([]);
        }}
        emptyText={intl.formatMessage({ id: 'multiChoices.saveToKnowledge.empty' })}
        folderEmptyText={intl.formatMessage({ id: 'fileSider.saveToKnowledge.rootTip' })}
      />
    </div>
  );
};

export default FileMiniList;
