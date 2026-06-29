import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { CopyOutlined, EllipsisOutlined, SearchOutlined } from '@ant-design/icons';
import { useIntl, useSelector } from '@umijs/max';
import AntdIcon from '@/components/AntdIcon';
import KnowledgeBreadcrumb from '@/components/KnowledgeBreadcrumb';
import KnowledgeTargetSelector from '@/components/KnowledgeTargetSelector';
import UploadConfirmModal, { type UploadConfirmFile } from '@/components/UploadConfirmModal';
import { DragType } from '@/components/QueryInput/withDrag';
import employeeStyles from '@/layout/sider/components/EmployeeList/index.module.less';
import useGlobal from '@/hooks/useGlobal';
import { getHistoryState } from '@/utils/browser';
import { copyTextToClipboard } from '@/utils/copy';
import {
  getMimeType,
  isPreviewable,
} from '@/components/QueryInput/components/FileBrowserEntry/components/FileBrowserPanel/constants';
import {
  copyFile,
  createFolder as createFileBrowserFolder,
  deleteFiles,
  downloadFile,
  downloadFolder,
  ensureFolder,
  listFiles,
  renameFile,
  searchFiles,
  uploadFiles,
  type FileBrowserItem,
} from '@/service/fileBrowser';
import RenameModal from '@/components/QueryInput/components/FileBrowserEntry/components/FileBrowserPanel/RenameModal';
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
import { IMessageState, SSEEventStatus } from '@/constants/message';
import commonStyles from '../Knowledge/components/common.module.less';
import styles from './index.module.less';

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

function toFileTreeData(
  list: FileBrowserItem[],
  childrenByPath: Record<string, FileBrowserItem[]>,
  expandedDirectoryKeySet: Set<string>
): FileTreeItem[] {
  return sortFileBrowserItems(list).map((item) => {
    const dir = isDirectory(item);
    const directoryPath = ensureDirectoryPath(item.path);
    const expanded = dir && expandedDirectoryKeySet.has(directoryPath);
    return {
      ...item,
      key: dir ? directoryPath : item.path,
      title: <span>{item.name}</span>,
      isLeaf: !dir,
      className: expanded ? styles.treeNodeExpanded : undefined,
      children:
        dir && childrenByPath[directoryPath]
          ? toFileTreeData(childrenByPath[directoryPath], childrenByPath, expandedDirectoryKeySet)
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

interface FileTreeItem extends FileBrowserItem {
  key: string;
  title: React.ReactNode;
  isLeaf: boolean;
  className?: string;
  children?: FileTreeItem[];
}

type FileCategoryKey = 'root' | 'session' | 'shared' | 'log';
type FileCopyTargetType = 'session' | 'shared';
type FileActionKey =
  | 'upload'
  | 'createFolder'
  | 'preview'
  | 'download'
  | 'rename'
  | 'delete'
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
const DISPLAY_FILE_PATH_PREFIX = '/by';
const BYKC_FILE_PATH = '/.bykc/';
const SESSION_FILE_PATH = '/.sessions/';
const SHARED_FILE_PATH = '/.shared/';
const LOG_FILE_PATH = '/.log/';
const OPENCLAW_FILE_PATH = '/.openclaw/';
const UIAGENT_FILE_PATH = '/.uiagent/';
const PROTECTED_ROOT_DIRECTORY_PATHS = new Set([
  BYKC_FILE_PATH,
  LOG_FILE_PATH,
  OPENCLAW_FILE_PATH,
  SESSION_FILE_PATH,
  SHARED_FILE_PATH,
  UIAGENT_FILE_PATH,
]);

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

function getCategoryActivePath(category: FileCategoryItem, sessionId?: string) {
  if (category.key === 'session') {
    return getSessionFilePath(sessionId);
  }
  return category.path;
}

function normalizeFileBrowserPath(path?: string) {
  const normalizedPath = `${path || '/'}`.trim().replace(/\\/g, '/').replace(/\/+/g, '/');
  if (!normalizedPath || normalizedPath === '/') {
    return '/';
  }
  return normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`;
}

function isProtectedRootDirectory(item: FileBrowserItem) {
  if (!isDirectory(item)) return false;
  const normalizedPath = ensureDirectoryPath(normalizeFileBrowserPath(item.path)).toLowerCase();
  return getPathDepth(normalizedPath) === 1 && PROTECTED_ROOT_DIRECTORY_PATHS.has(normalizedPath);
}

function getDisplayFileBrowserPath(path: string) {
  const normalizedPath = normalizeFileBrowserPath(path);
  return normalizedPath === ROOT_FILE_PATH
    ? `${DISPLAY_FILE_PATH_PREFIX}/`
    : `${DISPLAY_FILE_PATH_PREFIX}${normalizedPath}`;
}

function getFallbackCurrentSessionId() {
  if (typeof window === 'undefined') return '';
  const querySessionId = new URLSearchParams(window.location.search).get('sessionId');
  return getNormalizedSessionId(
    querySessionId || getHistoryState('pcSessionId', '') || getHistoryState('mobileSessionId', '')
  );
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

function getPayloadMessage(payload: any) {
  return payload?.message || payload?.data || payload;
}

function hasPayloadFiles(payload: any) {
  const message = getPayloadMessage(payload);
  return Boolean(
    payload?.fileList?.length ||
      payload?.imageList?.length ||
      payload?.files?.length ||
      message?.fileList?.length ||
      message?.imageList?.length ||
      message?.files?.length
  );
}

function isPayloadDone(payload: any) {
  const message = getPayloadMessage(payload);
  return message?.status === SSEEventStatus.done || message?.messageState === IMessageState.Done;
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

interface BykcKnowledgeUploadTarget {
  knowledgeBase: IKnowledgeBaseItem;
  directoryPath: string;
}

interface FileCategoryCache {
  path: string;
  items: FileBrowserItem[];
  childrenByPath: Record<string, FileBrowserItem[]>;
}

const FileMiniList: React.FC<FileMiniListProps> = ({ resourceId }) => {
  const intl = useIntl();
  const { EventEmitter, sessionId } = useGlobal();
  const clickTimerRef = useRef<number | null>(null);
  const categoryCacheRef = useRef<Partial<Record<FileCategoryKey, FileCategoryCache>>>({});
  const activeCategoryKeyRef = useRef<FileCategoryKey | undefined>('root');
  const currentPathRef = useRef('');
  const messageFileSignatureRef = useRef('');
  const messageFileSignatureInitializedRef = useRef(false);
  const messageFileSignatureSessionIdRef = useRef('');
  const fetchListRequestSeqRef = useRef(0);
  const [currentPath, setCurrentPath] = useState('');
  const [activeCategoryKey, setActiveCategoryKey] = useState<FileCategoryKey | undefined>('root');
  const [items, setItems] = useState<FileBrowserItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [pathInitialized, setPathInitialized] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [childrenByPath, setChildrenByPath] = useState<Record<string, FileBrowserItem[]>>({});
  const [expandedTreeKeys, setExpandedTreeKeys] = useState<React.Key[]>([]);
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
  const [pendingUploadConflicts, setPendingUploadConflicts] = useState<string[]>([]);
  const [pendingUploadKnowledgeTarget, setPendingUploadKnowledgeTarget] = useState<BykcKnowledgeUploadTarget | null>(
    null
  );
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
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<FileBrowserItem | null>(null);
  const [renameLoading, setRenameLoading] = useState(false);
  const [messageSessionId, setMessageSessionId] = useState('');
  const activeSessionId = useMemo(() => {
    return (
      getNormalizedSessionId(sessionId) || getNormalizedSessionId(messageSessionId) || getFallbackCurrentSessionId()
    );
  }, [messageSessionId, sessionId]);
  const currentSessionMessageFileSignature = useSelector((state: any) => {
    if (!activeSessionId) return '';
    const messageInfo = state?.messageStore?.sessionListMap?.get?.(`${activeSessionId}`);
    return getMessageFileSignature(messageInfo?.list || []);
  });

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
  }, []);

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
      if (!cacheKey) return;
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

  const expandCurrentSessionDirectory = useCallback(
    async (targetSessionId = activeSessionId) => {
      const normalizedSessionId = getNormalizedSessionId(targetSessionId);
      if (!normalizedSessionId || !resourceId) return;

      const sessionPath = getSessionFilePath(normalizedSessionId);
      try {
        await ensureFolder({ resourceId, path: sessionPath });
        const res: any = await listFiles({ resourceId, path: sessionPath });
        const sessionChildren = unwrapListResponse<FileBrowserItem>(res);

        setChildrenByPath((prev) => {
          const nextChildrenByPath = {
            ...prev,
            [sessionPath]: sessionChildren,
          };
          if (!isSearching && activeCategoryKeyRef.current === 'session') {
            updateCategoryCache('session', {
              path: SESSION_FILE_PATH,
              items: categoryCacheRef.current.session?.items ?? items,
              childrenByPath: nextChildrenByPath,
            });
          }
          return nextChildrenByPath;
        });
        setExpandedTreeKeys((prev) => (prev.includes(sessionPath) ? prev : [...prev, sessionPath]));
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.error.loadFailed' }));
      }
    },
    [activeSessionId, intl, isSearching, items, resourceId, updateCategoryCache]
  );

  const refreshExpandedDirectories = useCallback(
    async (payload?: { sessionId?: string }) => {
      const payloadSessionId = getMessagePayloadSessionId(payload);
      if (payloadSessionId) {
        setMessageSessionId(payloadSessionId);
      }

      const categoryKey = activeCategoryKeyRef.current;
      if (!categoryKey) return;

      const categoryRootPath = getCategoryRootPath(categoryKey);
      const normalizedCurrentPath = ensureDirectoryPath(normalizeFileBrowserPath(currentPathRef.current));
      const requestPath =
        categoryKey !== 'root' && !isPathIn(normalizedCurrentPath, categoryRootPath)
          ? categoryRootPath
          : normalizedCurrentPath;
      const expandedDirectoryPaths = Array.from(
        new Set(
          expandedTreeKeys
            .map((key) => ensureDirectoryPath(normalizeFileBrowserPath(String(key))))
            .filter((path) => path !== requestPath && (categoryKey === 'root' || isPathIn(path, categoryRootPath)))
        )
      );

      setLoading(true);
      try {
        const [rootResponse, ...expandedResponses] = await Promise.all([
          listFiles({ resourceId, path: requestPath }),
          ...expandedDirectoryPaths.map((path) => listFiles({ resourceId, path })),
        ]);
        const nextItems = unwrapListResponse<FileBrowserItem>(rootResponse);
        const refreshedChildrenByPath = expandedDirectoryPaths.reduce<Record<string, FileBrowserItem[]>>(
          (acc, path, index) => {
            acc[path] = unwrapListResponse<FileBrowserItem>(expandedResponses[index]);
            return acc;
          },
          {}
        );
        const nextChildrenByPath = {
          ...(categoryCacheRef.current[categoryKey]?.childrenByPath || {}),
          ...refreshedChildrenByPath,
        };

        updateCategoryCache(categoryKey, {
          path: requestPath,
          items: nextItems,
          childrenByPath: nextChildrenByPath,
        });

        if (
          activeCategoryKeyRef.current === categoryKey &&
          ensureDirectoryPath(normalizeFileBrowserPath(currentPathRef.current)) === requestPath
        ) {
          setItems(nextItems);
          setChildrenByPath(nextChildrenByPath);
        }
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.error.loadFailed' }));
      } finally {
        setLoading(false);
      }
    },
    [expandedTreeKeys, intl, resourceId, updateCategoryCache]
  );

  useEffect(() => {
    if (!activeSessionId) {
      messageFileSignatureRef.current = '';
      messageFileSignatureInitializedRef.current = false;
      messageFileSignatureSessionIdRef.current = '';
      return;
    }

    if (messageFileSignatureSessionIdRef.current !== activeSessionId) {
      messageFileSignatureRef.current = currentSessionMessageFileSignature;
      messageFileSignatureInitializedRef.current = true;
      messageFileSignatureSessionIdRef.current = activeSessionId;
      return;
    }

    if (messageFileSignatureRef.current === currentSessionMessageFileSignature) return;
    messageFileSignatureRef.current = currentSessionMessageFileSignature;

    const normalizedCurrentPath = ensureDirectoryPath(normalizeFileBrowserPath(currentPathRef.current));
    const activeSessionPath = getSessionFilePath(activeSessionId);
    if (
      activeCategoryKeyRef.current === 'session' &&
      (normalizedCurrentPath === SESSION_FILE_PATH || normalizedCurrentPath === activeSessionPath)
    ) {
      void refreshExpandedDirectories({ sessionId: activeSessionId });
    }
  }, [activeSessionId, currentSessionMessageFileSignature, refreshExpandedDirectories]);

  useEffect(() => {
    activeCategoryKeyRef.current = activeCategoryKey;
  }, [activeCategoryKey]);

  useEffect(() => {
    currentPathRef.current = currentPath;
  }, [currentPath]);

  useEffect(() => {
    const defaultCategoryKey = getDefaultFileCategoryKey(activeSessionId);
    const defaultCategory = fileCategories.find((item) => item.key === defaultCategoryKey);
    const defaultCategoryPath = defaultCategory
      ? getCategoryActivePath(defaultCategory, activeSessionId)
      : ROOT_FILE_PATH;
    const defaultExpandedKeys =
      defaultCategoryKey === 'session' && activeSessionId ? [getSessionFilePath(activeSessionId)] : [];
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
    setExpandedTreeKeys(defaultExpandedKeys);
    if (!resourceId) return;
    setPathInitialized(true);
  }, [activeSessionId, fileCategories, resourceId]);

  useEffect(() => {
    if (resourceId && pathInitialized && activeCategoryKey && currentPath) {
      void fetchList(currentPath).then(() => {
        if (activeCategoryKey === 'session' && currentPath === SESSION_FILE_PATH && activeSessionId) {
          void expandCurrentSessionDirectory(activeSessionId);
        }
      });
    }
  }, [
    activeCategoryKey,
    activeSessionId,
    currentPath,
    expandCurrentSessionDirectory,
    fetchList,
    pathInitialized,
    resourceId,
  ]);

  useEffect(() => {
    if (!activeCategory || !pathInitialized) return;
    const nextPath = getCategoryActivePath(activeCategory, activeSessionId);
    currentPathRef.current = nextPath;
    setCurrentPath(nextPath);
  }, [activeCategory, activeSessionId, pathInitialized]);

  const handleCategoryChange = useCallback(
    async (key: string | string[]) => {
      const nextKey = Array.isArray(key) ? key[0] : key;
      if (!nextKey) {
        activeCategoryKeyRef.current = undefined;
        currentPathRef.current = '';
        setActiveCategoryKey(undefined);
        setCurrentPath('');
        setSearchValue('');
        setIsSearching(false);
        setItems([]);
        setChildrenByPath({});
        setExpandedTreeKeys([]);
        return;
      }
      const nextCategory = fileCategories.find((item) => item.key === nextKey);
      if (!nextCategory) return;
      const nextCategoryPath = getCategoryActivePath(nextCategory, activeSessionId);

      // Clear cache so switching tabs always reloads the data.
      const cached = categoryCacheRef.current[nextCategory.key];
      delete categoryCacheRef.current[nextCategory.key];

      setActiveCategoryKey(nextCategory.key);
      setSearchValue('');
      setIsSearching(false);
      setItems([]);
      setChildrenByPath({});
      setExpandedTreeKeys(
        nextCategory.key === 'session' && activeSessionId ? [getSessionFilePath(activeSessionId)] : []
      );
      // Only ensure the folder when there is no cache, which means the first visit.
      if (nextCategory.ensure && !cached) {
        try {
          await ensureFolder({ resourceId, path: nextCategoryPath });
        } catch (error: any) {
          message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.createFolder.failed' }));
        }
      }
      activeCategoryKeyRef.current = nextCategory.key;
      currentPathRef.current = nextCategoryPath;
      setCurrentPath(nextCategoryPath);
      await fetchList(nextCategoryPath, { force: true, categoryKey: nextCategory.key });
      if (nextCategory.key === 'session') {
        await expandCurrentSessionDirectory(activeSessionId);
      }
    },
    [activeSessionId, expandCurrentSessionDirectory, fetchList, fileCategories, intl, resourceId]
  );

  // Refresh the active category and expanded folders when chat messages produce files.
  useEffect(() => {
    const shouldRefresh = (payload?: any) => {
      const payloadSessionId = getMessagePayloadSessionId(payload);
      if (payloadSessionId && activeSessionId && payloadSessionId !== activeSessionId) {
        return false;
      }
      return hasPayloadFiles(payload) || isPayloadDone(payload);
    };

    const handleSessionFileCreated = (payload: any) => {
      if (shouldRefresh(payload)) {
        void refreshExpandedDirectories(payload);
      }
    };

    const handleSessionFileUpdated = (payload: any) => {
      if (shouldRefresh(payload)) {
        void refreshExpandedDirectories(payload);
      }
    };

    const handleSessionFilesUpdated = (payload: any) => {
      void refreshExpandedDirectories(payload);
    };

    EventEmitter.on('beyond-create-message', handleSessionFileCreated);
    EventEmitter.on('beyond-update-message', handleSessionFileUpdated);
    EventEmitter.on('fileBrowser-session-files-updated', handleSessionFilesUpdated);
    return () => {
      EventEmitter.off('beyond-create-message', handleSessionFileCreated);
      EventEmitter.off('beyond-update-message', handleSessionFileUpdated);
      EventEmitter.off('fileBrowser-session-files-updated', handleSessionFilesUpdated);
    };
  }, [EventEmitter, activeSessionId, refreshExpandedDirectories]);

  const sortedItems = useMemo(() => {
    return sortFileBrowserItems(items);
  }, [items]);

  const fileTreeData = useMemo(() => {
    const expandedDirectoryKeySet = new Set(
      expandedTreeKeys.map((key) => ensureDirectoryPath(normalizeFileBrowserPath(String(key))))
    );
    return toFileTreeData(sortedItems, childrenByPath, expandedDirectoryKeySet);
  }, [childrenByPath, expandedTreeKeys, sortedItems]);

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
      if (options.loading) {
        EventEmitter.emit('beyond-main-driver-open-type', {
          title: item.name,
          width: '50vw',
          minWidth: '360px',
          maxWidth: '70vw',
          drawerType: 'preview',
          canClose: true,
          canFullScreen: false,
        });
      }
      EventEmitter.emit('beyond-main-driver-message', {
        data: options.blob ?? undefined,
        type: getFileType(item.name),
        title: item.name,
        className: styles.previewContent,
      });
    },
    [EventEmitter]
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
      }
    },
    [intl, message, renderPreviewPanel, resourceId]
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
    async (targetPath: string): Promise<BykcKnowledgeUploadTarget | null> => {
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
    async (
      targetPath: string,
      fileList: File[],
      processFrontMatter: boolean,
      options: { overwrite?: boolean; target?: BykcKnowledgeUploadTarget | null } = {}
    ) => {
      const target = options.target || (await resolveKnowledgeUploadTarget(targetPath));
      if (!target) return;

      const formData = new FormData();
      fileList.forEach((file) => {
        formData.append('files', file);
      });
      formData.append('resourceId', String(target.knowledgeBase.resourceId));
      formData.append('directoryPath', target.directoryPath);
      formData.append('processFrontMatter', String(!processFrontMatter));
      formData.append('overwrite', String(Boolean(options.overwrite)));

      await uploadKnowledgeFiles(formData);
      message.success(intl.formatMessage({ id: 'fileBrowser.upload.knowledgeBuildSuccess' }));
      setUploadConfirmOpen(false);
      setPendingUploadFiles([]);
      setPendingUploadPath('');
      setPendingUploadConflicts([]);
      setPendingUploadKnowledgeTarget(null);

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
          await executeKnowledgeDirectoryUpload(uploadPath, fileList, processFrontMatter, {
            overwrite: pendingUploadConflicts.length > 0,
            target: pendingUploadKnowledgeTarget,
          });
          return;
        }
        await uploadFiles(resourceId, uploadPath, fileList);
        message.success(intl.formatMessage({ id: 'fileBrowser.upload.success' }));
        setUploadConfirmOpen(false);
        setPendingUploadFiles([]);
        setPendingUploadPath('');
        setPendingUploadConflicts([]);
        setPendingUploadKnowledgeTarget(null);
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
      pendingUploadConflicts.length,
      pendingUploadKnowledgeTarget,
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

  const handleDeleteFileBrowserItem = useCallback(
    async (item: FileBrowserItem) => {
      if (isProtectedRootDirectory(item)) return;
      const itemPath = normalizeFileBrowserPath(item.path);
      const parentPath = getParentDirectoryPath(itemPath);
      try {
        await deleteFiles({ resourceId, paths: [item.path] });
        message.success(intl.formatMessage({ id: 'fileBrowser.delete.success' }));
        if (isDirectory(item) && isPathIn(currentPath, ensureDirectoryPath(itemPath))) {
          currentPathRef.current = parentPath;
          setCurrentPath(parentPath);
          await fetchList(parentPath, { force: true });
          return;
        }
        await refreshFileBrowserDirectory(parentPath);
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.delete.failed' }));
      }
    },
    [currentPath, fetchList, intl, refreshFileBrowserDirectory, resourceId]
  );

  const handleRenameOk = useCallback(
    async (newName: string) => {
      if (!renameTarget) return;
      if (isProtectedRootDirectory(renameTarget)) {
        setRenameOpen(false);
        setRenameTarget(null);
        return;
      }
      const parentPath = getParentDirectoryPath(renameTarget.path);
      setRenameLoading(true);
      try {
        await renameFile({ resourceId, sourcePath: renameTarget.path, newName });
        message.success(intl.formatMessage({ id: 'fileBrowser.rename.success' }));
        setRenameOpen(false);
        setRenameTarget(null);
        if (isDirectory(renameTarget) && isPathIn(currentPath, ensureDirectoryPath(renameTarget.path))) {
          currentPathRef.current = parentPath;
          setCurrentPath(parentPath);
          await fetchList(parentPath, { force: true });
          return;
        }
        await refreshFileBrowserDirectory(parentPath);
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.rename.failed' }));
      } finally {
        setRenameLoading(false);
      }
    },
    [currentPath, fetchList, intl, refreshFileBrowserDirectory, renameTarget, resourceId]
  );

  const handleUploadSelect = useCallback(
    async (targetPath: string, fileList: File[]) => {
      if (!fileList.length) return;
      const uploadPath = ensureDirectoryPath(targetPath);
      let uploadConflicts: string[] = [];
      let uploadKnowledgeTarget: BykcKnowledgeUploadTarget | null = null;

      try {
        if (isPathIn(uploadPath, BYKC_FILE_PATH)) {
          uploadKnowledgeTarget = await resolveKnowledgeUploadTarget(uploadPath);
          if (!uploadKnowledgeTarget) return;
          const response = await checkUploadFileConflicts({
            resourceId: uploadKnowledgeTarget.knowledgeBase.resourceId,
            directoryPath: uploadKnowledgeTarget.directoryPath,
            fileNames: fileList.map((file) => file.name),
          });
          uploadConflicts = response?.overwritePaths || [];
        }

        setPendingUploadPath(uploadPath);
        setPendingUploadFiles(fileList);
        setPendingUploadConflicts(uploadConflicts);
        setPendingUploadKnowledgeTarget(uploadKnowledgeTarget);
        setUploadConfirmOpen(true);
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.upload.failed' }));
      }
    },
    [intl, resolveKnowledgeUploadTarget]
  );

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
      const categoryPath = getCategoryActivePath(category, activeSessionId);
      try {
        if (category.key !== 'root') {
          await ensureFolder({ resourceId, path: categoryPath });
        }
        await handleUploadSelect(categoryPath, fileList);
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.createFolder.failed' }));
      }
    },
    [activeSessionId, handleUploadSelect, intl, resourceId]
  );

  const handleRefreshCategory = useCallback(
    async (category: FileCategoryItem) => {
      const categoryPath = getCategoryActivePath(category, activeSessionId);
      try {
        if (category.key !== 'root') {
          await ensureFolder({ resourceId, path: categoryPath });
        }
        // Clear cache to match the result of collapsing and reopening the tab.
        delete categoryCacheRef.current[category.key];
        // Clear all child-folder cache data.
        setChildrenByPath({});
        setExpandedTreeKeys(category.key === 'session' && activeSessionId ? [getSessionFilePath(activeSessionId)] : []);
        // Clear the current list before fetching again.
        setItems([]);
        await fetchList(categoryPath, { force: true, categoryKey: category.key });
        if (category.key === 'session') {
          await expandCurrentSessionDirectory(activeSessionId);
        }
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.error.loadFailed' }));
      }
    },
    [activeSessionId, expandCurrentSessionDirectory, fetchList, intl, resourceId]
  );

  const openCategoryPath = useCallback(
    async (category: FileCategoryItem, path: string) => {
      const categoryPath = ensureDirectoryPath(path || getCategoryActivePath(category, activeSessionId));
      try {
        if (category.key !== 'root') {
          await ensureFolder({ resourceId, path: categoryPath });
        }
        delete categoryCacheRef.current[category.key];
        setActiveCategoryKey(category.key);
        activeCategoryKeyRef.current = category.key;
        currentPathRef.current = categoryPath;
        setCurrentPath(categoryPath);
        setSearchValue('');
        setIsSearching(false);
        setItems([]);
        setChildrenByPath({});
        setExpandedTreeKeys(category.key === 'session' && activeSessionId ? [getSessionFilePath(activeSessionId)] : []);
        await fetchList(categoryPath, { force: true, categoryKey: category.key });
        if (category.key === 'session' && categoryPath === SESSION_FILE_PATH) {
          await expandCurrentSessionDirectory(activeSessionId);
        }
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.error.loadFailed' }));
      }
    },
    [activeSessionId, expandCurrentSessionDirectory, fetchList, intl, resourceId]
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
    setPendingUploadConflicts([]);
    setPendingUploadKnowledgeTarget(null);
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
      const defaultPath = getCopyTargetPath(targetType, activeSessionId);
      setCopyTarget(item);
      setCopyTargetType(targetType);
      setCopyDirectoryPath(defaultPath);
      setCopyFolders([]);
      setCopyModalOpen(true);
      void loadCopyFolders(defaultPath);
    },
    [activeSessionId, clearClickTimer, loadCopyFolders]
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
      const activeSessionPath = getSessionFilePath(activeSessionId);
      const sessionFolderExpanded =
        activeSessionId &&
        expandedTreeKeys
          .map((key) => ensureDirectoryPath(normalizeFileBrowserPath(String(key))))
          .includes(activeSessionPath);
      if (
        copyTargetType === 'session' &&
        activeCategoryKeyRef.current === 'session' &&
        sessionFolderExpanded &&
        isPathIn(copyDirectoryPath, activeSessionPath)
      ) {
        await refreshExpandedDirectories({ sessionId: activeSessionId });
      }
      setCopyModalOpen(false);
      setCopyTarget(null);
    } catch (error: any) {
      message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.copy.failed' }));
    } finally {
      setCopyingToFileBrowser(false);
    }
  }, [
    activeSessionId,
    copyDirectoryPath,
    copyTarget,
    copyTargetType,
    expandedTreeKeys,
    intl,
    refreshExpandedDirectories,
    resourceId,
  ]);

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
  let uploadConfirmConflicts: string[] = [];
  if (isKnowledgeUploadConfirm) {
    uploadConfirmConflicts = pendingKnowledgeConflicts;
  } else if (isBykcUploadConfirm) {
    uploadConfirmConflicts = pendingUploadConflicts;
  }
  const uploadConfirmLoading = isKnowledgeUploadConfirm ? savingToKnowledge : uploadingFiles;
  let uploadConfirmOkText = intl.formatMessage({ id: 'fileBrowser.toolbar.upload' });
  if (isKnowledgeUploadConfirm) {
    const okTextId = pendingKnowledgeConflicts.length
      ? 'knowledgeDetail.confirmOverwriteUpload'
      : 'knowledgeDetail.uploadFile';
    uploadConfirmOkText = intl.formatMessage({ id: okTextId });
  } else if (isBykcUploadConfirm) {
    uploadConfirmOkText = intl.formatMessage({
      id: pendingUploadConflicts.length ? 'knowledgeDetail.confirmOverwriteUpload' : 'knowledgeDetail.uploadFile',
    });
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
      const categoryPath = getCategoryActivePath(category, activeSessionId);
      const uploadTitle = intl.formatMessage({ id: 'fileBrowser.toolbar.upload' });
      const createTitle = intl.formatMessage({ id: 'fileBrowser.toolbar.newFolder' });
      const refreshTitle = intl.formatMessage({ id: 'fileBrowser.toolbar.refresh' });
      // const locateTitle = intl.formatMessage({ id: 'fileBrowser.toolbar.locate' });

      return (
        <span className={styles.categoryActions} onClick={(event) => event.stopPropagation()}>
          {/* {category.key === 'session' && activeSessionId && (
            <Button
              size="small"
              className={`${styles.categoryActionButton} ${styles.categoryLocateButton}`}
              title={locateTitle}
              onClick={(event) => {
                event.stopPropagation();
                void openCategoryPath(category, getSessionFilePath(activeSessionId));
              }}
            >
              {locateTitle}
            </Button>
          )} */}
          {canManageCategory && (
            <Tooltip title={uploadTitle}>
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
                />
              </Upload>
            </Tooltip>
          )}
          {canManageCategory && (
            <Tooltip title={createTitle}>
              <Button
                icon={<AntdIcon type="icon-a-Folder-pluswenjianjia-tianjia" className={styles.categoryActionIcon} />}
                size="small"
                className={styles.categoryActionButton}
                onClick={(event) => {
                  event.stopPropagation();
                  openCreateFolder(categoryPath);
                }}
              />
            </Tooltip>
          )}
          <Tooltip title={refreshTitle}>
            <Button
              icon={<AntdIcon type="icon-a-Refreshshuaxin1" className={styles.categoryActionIcon} />}
              size="small"
              className={styles.categoryActionButton}
              onClick={(event) => {
                event.stopPropagation();
                void handleRefreshCategory(category);
              }}
            />
          </Tooltip>
        </span>
      );
    },
    [activeSessionId, handleCategoryUploadSelect, handleRefreshCategory, intl, openCategoryPath, openCreateFolder]
  );

  const handleCopyCategoryPath = useCallback(
    (path: string, event: React.MouseEvent<HTMLElement>) => {
      event.stopPropagation();
      void copyTextToClipboard(
        getDisplayFileBrowserPath(path),
        () => message.success(intl.formatMessage({ id: 'common.copySuccess' })),
        () => message.error(intl.formatMessage({ id: 'common.copyFail' }))
      );
    },
    [intl]
  );

  const renderCategoryPath = useCallback(
    (category: FileCategoryItem) => {
      const categoryPath = getCategoryActivePath(category, activeSessionId);
      const displayCategoryPath = getDisplayFileBrowserPath(categoryPath);
      const categoryRootPath = getCategoryRootPath(category.key);
      const pathSegments = buildScopedFolderPath(categoryPath, categoryRootPath);

      if (!pathSegments.length) {
        return (
          <span className={styles.categoryPathRow} title={displayCategoryPath}>
            <span className={styles.categoryPath}>
              <button
                type="button"
                className={styles.categoryPathSegment}
                onClick={(event) => {
                  event.stopPropagation();
                  void openCategoryPath(category, categoryPath);
                }}
              >
                {displayCategoryPath}
              </button>
            </span>
            <Tooltip title={intl.formatMessage({ id: 'common.copy' })}>
              <button
                type="button"
                className={styles.categoryPathCopy}
                onClick={(event) => handleCopyCategoryPath(categoryPath, event)}
              >
                <CopyOutlined />
              </button>
            </Tooltip>
          </span>
        );
      }

      return (
        <span className={styles.categoryPathRow} title={displayCategoryPath}>
          <span
            className={styles.categoryPath}
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            {DISPLAY_FILE_PATH_PREFIX}/
            {pathSegments.map((segment) => (
              <React.Fragment key={segment.id}>
                <button
                  type="button"
                  className={styles.categoryPathSegment}
                  onClick={(event) => {
                    event.stopPropagation();
                    void openCategoryPath(category, segment.id);
                  }}
                >
                  {segment.title}
                </button>
                /
              </React.Fragment>
            ))}
          </span>
          <Tooltip title={intl.formatMessage({ id: 'common.copy' })}>
            <button
              type="button"
              className={styles.categoryPathCopy}
              onClick={(event) => handleCopyCategoryPath(categoryPath, event)}
            >
              <CopyOutlined />
            </button>
          </Tooltip>
        </span>
      );
    },
    [activeSessionId, handleCopyCategoryPath, intl, openCategoryPath]
  );

  const getFileActionItems = useCallback(
    (item: FileTreeItem) => {
      const dir = isDirectory(item);
      const actionScope = getFileActionScope(activeCategoryKey, item);
      const extraActions: FileActionKey[] = [];
      const isRootCategoryTopLevelDirectory = activeCategoryKey === 'root' && dir && getPathDepth(item.path) === 1;
      const protectedRootDirectory = activeCategoryKey === 'root' && isProtectedRootDirectory(item);
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
        'rename',
        'delete',
        ...extraActions,
      ];

      return actionKeys
        .filter((key) => !(protectedRootDirectory && (key === 'rename' || key === 'delete')))
        .map((key) => {
          if (key === 'upload') {
            return {
              key,
              label: (
                <Upload
                  showUploadList={false}
                  multiple
                  beforeUpload={(_, fileList) => {
                    void handleUploadSelect(item.path, fileList as unknown as File[]);
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
            rename: 'fileBrowser.action.rename',
            delete: 'fileBrowser.action.delete',
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
              expandedKeys={expandedTreeKeys}
              onExpand={(keys) => setExpandedTreeKeys(keys)}
              loadData={(node) => loadTreeNode(node as unknown as FileTreeItem)}
              icon={(node) => {
                const item = node as unknown as FileTreeItem;
                const directoryExpanded =
                  isDirectory(item) &&
                  expandedTreeKeys.includes(ensureDirectoryPath(normalizeFileBrowserPath(item.path)));
                const iconType = directoryExpanded
                  ? 'a-Folder-openwenjianjia-kai'
                  : getIconType(item.name, isDirectory(item));
                return (
                  <Tooltip title={item.name} placement="right">
                    <span>
                      <AntdIcon type={`icon-${iconType}`} />
                    </span>
                  </Tooltip>
                );
              }}
              className={`${commonStyles.tree} ${styles.fileTree}`}
              onClick={handleTreeNodeClick as any}
              onDoubleClick={(_, node) => handleItemDoubleClick(node as unknown as FileTreeItem)}
              titleRender={(item) => {
                const treeItem = item as FileTreeItem;
                const previewable = canPreviewFile(treeItem);
                const directoryExpanded =
                  isDirectory(treeItem) &&
                  expandedTreeKeys.includes(ensureDirectoryPath(normalizeFileBrowserPath(treeItem.path)));
                const directoryCurrent =
                  isDirectory(treeItem) &&
                  ensureDirectoryPath(normalizeFileBrowserPath(treeItem.path)) ===
                    ensureDirectoryPath(normalizeFileBrowserPath(currentPath));

                return (
                  <span
                    className={[
                      styles.treeTitleContent,
                      directoryExpanded ? styles.treeTitleContentExpanded : '',
                      directoryCurrent ? styles.treeTitleContentCurrent : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <Tooltip title={item.name} placement="right">
                      <span
                        className={[styles.treeTitleName, previewable ? styles.previewableTreeTitle : '']
                          .filter(Boolean)
                          .join(' ')}
                      >
                        <span className={styles.treeTitleText}>{item.name}</span>
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
                          } else if (key === 'rename') {
                            setRenameTarget(item as FileTreeItem);
                            setRenameOpen(true);
                          } else if (key === 'delete') {
                            Modal.confirm({
                              title: intl.formatMessage({ id: 'fileBrowser.delete.confirm' }),
                              content: intl.formatMessage(
                                { id: 'fileBrowser.delete.confirmName' },
                                { name: (item as FileTreeItem).name }
                              ),
                              onOk: () => handleDeleteFileBrowserItem(item as FileTreeItem),
                            });
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
        activeKey={activeCategoryKey ? [activeCategoryKey] : []}
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
              {renderCategoryPath(category)}
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
      <RenameModal
        open={renameOpen}
        currentName={renameTarget?.name || ''}
        onOk={handleRenameOk}
        onCancel={() => {
          if (renameLoading) return;
          setRenameOpen(false);
          setRenameTarget(null);
        }}
        loading={renameLoading}
      />
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
        <Space direction="vertical" size={12} className={styles.modalContentStack}>
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
                  className={styles.clickableListItem}
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
        <Space direction="vertical" size={12} className={styles.modalContentStack}>
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
                  className={styles.clickableListItem}
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
