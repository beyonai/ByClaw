import UnfinishedUploads from '@/components/UnfinishedUploads';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Collapse, Input, Modal, Upload, message } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useIntl, useSelector } from '@umijs/max';
import type { UploadConfirmFile } from '@/components/UploadConfirmModal';
import { DragType } from '@/components/QueryInput/withDrag';
import employeeStyles from '@/layout/sider/components/EmployeeList/index.module.less';
import useGlobal from '@/hooks/useGlobal';
import { isAdminVip } from '@/utils/auth';
import { copyTextToClipboard } from '@/utils/copy';
import {
  createFolder as createFileBrowserFolder,
  deleteFiles,
  ensureFolder,
  listFiles,
  renameFile,
  searchFiles,
  uploadFiles,
  type FileBrowserItem,
} from '@/service/fileBrowser';
import { queryDigEmployeeManageKnowledgeResourceAuth } from '@/pages/manager/service/resources';
import { checkUploadFileConflicts, uploadFiles as uploadKnowledgeFiles } from '@/service/knowledgeCenter';
import type { IKnowledgeBaseItem } from '@/layout/sider/components/Knowledge/components/KnowledgeBase/types';
import FileCategoryHeader from './components/FileCategoryHeader';
import FileMiniListModals from './components/FileMiniListModals';
import FileTreeList from './components/FileTreeList';
import SearchResultList from './components/SearchResultList';
import useCopyToFileBrowser from './hooks/useCopyToFileBrowser';
import useFilePreviewActions from './hooks/useFilePreviewActions';
import useSaveToKnowledge from './hooks/useSaveToKnowledge';
import useFileTransferQueue, { type FileTransferContext, type FileTransferTask } from './hooks/useFileTransferQueue';
import {
  BYKC_FILE_PATH,
  getVisibleFileCategories,
  ROOT_FILE_PATH,
  SHARED_FILE_PATH,
  type FileActionKey,
  type FileCategoryItem,
  type FileCategoryKey,
  type FileTreeItem,
} from './constants';
import {
  buildScopedFolderPath,
  buildTargetFolderPath,
  canPreviewFile,
  ensureDirectoryPath,
  getCategoryActivePath,
  getCategoryRootPath,
  getDefaultFileCategoryKey,
  getDisplayFileBrowserPath,
  getFallbackCurrentSessionId,
  getFileActionScope,
  getFileCategoryKeyByPath,
  getMessagePayloadSessionId,
  getNormalizedSessionId,
  getParentDirectoryPath,
  getPathDepth,
  getSessionFilePath,
  isAllowedUploadDirectoryTarget,
  isDirectory,
  isPathIn,
  isProtectedRootDirectory,
  normalizeFileBrowserPath,
  normalizeReferenceItem,
  resolveBykcKnowledgeUploadTarget,
  sortFileBrowserItems,
  unwrapListResponse,
} from './utils';
import styles from './index.module.less';

interface FileMiniListProps {
  resourceId: string;
}

// 过程文件列表统一使用后端排序，展开目录和刷新请求也必须保持同一规则。
const PROCESS_FILE_LIST_SORT = 'DIRECTORY_FIRST_NAME_ASC' as const;

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
  const userInfo = useSelector(({ user }: any) => user?.userInfo);
  const clickTimerRef = useRef<number | null>(null);
  const categoryCacheRef = useRef<Partial<Record<FileCategoryKey, FileCategoryCache>>>({});
  const activeCategoryKeyRef = useRef<FileCategoryKey | undefined>('root');
  const currentPathRef = useRef('');
  const fetchListRequestSeqRef = useRef(0);
  const searchRequestSeqRef = useRef(0);
  const isSearchingRef = useRef(false);
  const childCacheInvalidVersionRef = useRef<Partial<Record<FileCategoryKey, number>>>({});
  const childCacheLoadedVersionRef = useRef<Partial<Record<FileCategoryKey, Record<string, number>>>>({});
  const categorySwitchRequestRef = useRef<{ key: FileCategoryKey; path: string } | null>(null);
  const [currentPath, setCurrentPath] = useState('');
  const [activeCategoryKey, setActiveCategoryKey] = useState<FileCategoryKey | undefined>('root');
  const [items, setItems] = useState<FileBrowserItem[]>([]);
  const [searchItems, setSearchItems] = useState<FileBrowserItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [pathInitialized, setPathInitialized] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [childrenByPath, setChildrenByPath] = useState<Record<string, FileBrowserItem[]>>({});
  const [expandedTreeKeys, setExpandedTreeKeysState] = useState<React.Key[]>([]);
  const expandedTreeKeysRef = useRef<React.Key[]>([]);
  const setExpandedTreeKeys = useCallback((keys: React.Key[]) => {
    // rc-tree may finish an old load during a refresh; keep the latest intent synchronous.
    expandedTreeKeysRef.current = keys;
    setExpandedTreeKeysState(keys);
  }, []);
  // 受控接管 rc-tree 的 loadedKeys：它默认把展开过的目录永久标记为已加载并跳过 loadData，
  // 刷新后再展开就不会重新请求。目录数据失效时必须把对应 key 摘掉。
  const [loadedTreeKeys, setLoadedTreeKeys] = useState<React.Key[]>([]);
  const [uploadConfirmOpen, setUploadConfirmOpen] = useState(false);
  const [pendingUploadFiles, setPendingUploadFiles] = useState<File[]>([]);
  const [pendingUploadPath, setPendingUploadPath] = useState('');
  const [pendingUploadConflicts, setPendingUploadConflicts] = useState<string[]>([]);
  const [pendingUploadKnowledgeTarget, setPendingUploadKnowledgeTarget] = useState<BykcKnowledgeUploadTarget | null>(
    null
  );
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const uploadRunCountRef = useRef(0);
  const uploadIdentityRef = useRef(0);
  const pendingUploadContextRef = useRef<FileTransferContext | undefined>();
  const [uploadDirectoryPickerOpen, setUploadDirectoryPickerOpen] = useState(false);
  const [uploadDirectoryPath, setUploadDirectoryPath] = useState('/');
  const [uploadDirectoryBasePath, setUploadDirectoryBasePath] = useState('/');
  const [uploadDirectoryFolders, setUploadDirectoryFolders] = useState<FileBrowserItem[]>([]);
  const [uploadDirectoryLoading, setUploadDirectoryLoading] = useState(false);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [createFolderParentPath, setCreateFolderParentPath] = useState('');
  const [createFolderName, setCreateFolderName] = useState('');
  const [createFolderError, setCreateFolderError] = useState('');
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

  const contextIdentity = JSON.stringify([
    resourceId,
    userInfo?.userCode,
    userInfo?.userId,
    userInfo?.enterpriseId,
    activeSessionId,
  ]);
  const contextSequence = useRef(0);
  const contextRef = useRef<(FileTransferContext & { identity: string }) | undefined>();
  const mountedRef = useRef(true);
  if (contextRef.current?.identity !== contextIdentity) {
    contextRef.current = {
      identity: contextIdentity,
      key: `${contextIdentity}:${++contextSequence.current}`,
      resourceId,
      ownerKey: userInfo?.userCode || '',
      sessionId: activeSessionId,
    };
  }
  const transferContext = contextRef.current!;
  const isCurrentContext = useCallback(
    (context: FileTransferContext) => mountedRef.current && contextRef.current === context,
    []
  );
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    fetchListRequestSeqRef.current += 1;
    searchRequestSeqRef.current += 1;
    uploadRunCountRef.current = 0;
    pendingUploadContextRef.current = undefined;
    setUploadingFiles(false);
    setUploadConfirmOpen(false);
    setPendingUploadFiles([]);
    setPendingUploadPath('');
    setPendingUploadConflicts([]);
    setPendingUploadKnowledgeTarget(null);
    setUploadDirectoryPickerOpen(false);
    setUploadDirectoryFolders([]);
    setUploadDirectoryLoading(false);
    setCreateFolderOpen(false);
    setRenameOpen(false);
    setRenameTarget(null);
  }, [transferContext]);

  const fileCategories = useMemo<FileCategoryItem[]>(() => {
    return getVisibleFileCategories(isAdminVip(userInfo));
  }, [userInfo]);

  const activeCategory = useMemo(() => {
    return fileCategories.find((item) => item.key === activeCategoryKey);
  }, [activeCategoryKey, fileCategories]);
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

  // 清空子目录数据时必须连带清掉 rc-tree 的 loadedKeys，否则它仍认为目录已加载完，
  // 展开时不再触发 loadData，树上就永远是空的。
  const clearChildDirectoryState = useCallback(() => {
    setChildrenByPath({});
    setLoadedTreeKeys([]);
  }, []);

  const resetChildDirectoryCacheVersion = useCallback((categoryKey: FileCategoryKey | undefined) => {
    if (!categoryKey) return;
    delete childCacheInvalidVersionRef.current[categoryKey];
    delete childCacheLoadedVersionRef.current[categoryKey];
    setLoadedTreeKeys([]);
  }, []);

  const markChildDirectoryCacheStale = useCallback((categoryKey: FileCategoryKey | undefined) => {
    if (!categoryKey) return;
    childCacheInvalidVersionRef.current[categoryKey] = (childCacheInvalidVersionRef.current[categoryKey] || 0) + 1;
    // 数据作废的同时必须摘掉 rc-tree 的 loadedKeys，否则它认为目录已加载过，
    // 用户再展开时不会触发 loadData。刷新调用方同时折叠子树，避免后台补查已展开节点。
    setLoadedTreeKeys([]);
  }, []);

  const markChildDirectoriesFresh = useCallback((categoryKey: FileCategoryKey | undefined, paths: string[]) => {
    if (!categoryKey || !paths.length) return;
    const loadedVersionMap = childCacheLoadedVersionRef.current[categoryKey] || {};
    const currentVersion = childCacheInvalidVersionRef.current[categoryKey] || 0;
    const normalizedPaths = paths.map((path) => ensureDirectoryPath(normalizeFileBrowserPath(path)));
    normalizedPaths.forEach((path) => {
      loadedVersionMap[path] = currentVersion;
    });
    childCacheLoadedVersionRef.current[categoryKey] = loadedVersionMap;
    setLoadedTreeKeys((prev) => Array.from(new Set([...prev, ...normalizedPaths])));
  }, []);

  const isChildDirectoryCacheStale = useCallback((categoryKey: FileCategoryKey | undefined, path: string) => {
    if (!categoryKey) return false;
    const currentVersion = childCacheInvalidVersionRef.current[categoryKey] || 0;
    const loadedVersion =
      childCacheLoadedVersionRef.current[categoryKey]?.[ensureDirectoryPath(normalizeFileBrowserPath(path))] || 0;
    return loadedVersion < currentVersion;
  }, []);

  const fetchList = useCallback(
    async (path: string, options: { force?: boolean; categoryKey?: FileCategoryKey | undefined } = {}) => {
      const context = transferContext;
      if (!isCurrentContext(context)) return;
      const cacheKey = options.categoryKey ?? activeCategoryKey;
      if (!cacheKey) return;
      const categoryRootPath = getCategoryRootPath(cacheKey);
      const normalizedPath = ensureDirectoryPath(normalizeFileBrowserPath(path || categoryRootPath));
      const requestPath =
        cacheKey !== 'root' && !isPathIn(normalizedPath, categoryRootPath) ? categoryRootPath : normalizedPath;
      const cached = cacheKey ? categoryCacheRef.current[cacheKey] : undefined;
      if (!options.force && cached?.path === requestPath) {
        if (
          !isSearchingRef.current &&
          activeCategoryKeyRef.current === cacheKey &&
          currentPathRef.current === requestPath
        ) {
          setItems(cached.items);
          setChildrenByPath(cached.childrenByPath);
        }
        return;
      }
      const requestSeq = ++fetchListRequestSeqRef.current;
      setLoading(true);
      try {
        const res: any = await listFiles({ resourceId, path: requestPath, sort: PROCESS_FILE_LIST_SORT });
        if (!isCurrentContext(context)) return;
        const data = res?.data ?? res ?? [];
        const nextItems = Array.isArray(data) ? data : [];
        const nextChildrenByPath = options.force ? {} : cached?.childrenByPath || {};
        if (options.force) {
          resetChildDirectoryCacheVersion(cacheKey);
        }
        updateCategoryCache(cacheKey, {
          path: requestPath,
          items: nextItems,
          childrenByPath: nextChildrenByPath,
        });
        if (
          requestSeq === fetchListRequestSeqRef.current &&
          !isSearchingRef.current &&
          activeCategoryKeyRef.current === cacheKey &&
          currentPathRef.current === requestPath
        ) {
          setItems(nextItems);
          setChildrenByPath(nextChildrenByPath);
        }
      } catch (error: any) {
        if (!isCurrentContext(context)) return;
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.error.loadFailed' }));
      } finally {
        if (isCurrentContext(context) && requestSeq === fetchListRequestSeqRef.current) {
          setLoading(false);
        }
      }
    },
    [
      transferContext,
      isCurrentContext,
      activeCategoryKey,
      intl,
      resetChildDirectoryCacheVersion,
      resourceId,
      updateCategoryCache,
    ]
  );

  const refreshCurrentDirectory = useCallback(
    async (payload?: { sessionId?: string }) => {
      const context = transferContext;
      if (!isCurrentContext(context)) return;
      const payloadSessionId = getMessagePayloadSessionId(payload);
      if (payloadSessionId) {
        setMessageSessionId(payloadSessionId);
      }

      const categoryKey = activeCategoryKeyRef.current;
      if (!categoryKey) return;
      markChildDirectoryCacheStale(categoryKey);

      const categoryRootPath = getCategoryRootPath(categoryKey);
      const normalizedCurrentPath = ensureDirectoryPath(normalizeFileBrowserPath(currentPathRef.current));
      const requestPath =
        categoryKey !== 'root' && !isPathIn(normalizedCurrentPath, categoryRootPath)
          ? categoryRootPath
          : normalizedCurrentPath;
      // Refresh only this directory; nested directories reload on the next explicit expansion.
      setExpandedTreeKeys([]);
      clearChildDirectoryState();

      setLoading(true);
      try {
        const rootResponse = await listFiles({ resourceId, path: requestPath, sort: PROCESS_FILE_LIST_SORT });
        if (!isCurrentContext(context)) return;
        const nextItems = unwrapListResponse<FileBrowserItem>(rootResponse);
        const nextChildrenByPath: Record<string, FileBrowserItem[]> = {};

        updateCategoryCache(categoryKey, {
          path: requestPath,
          items: nextItems,
          childrenByPath: nextChildrenByPath,
        });

        if (
          !isSearchingRef.current &&
          activeCategoryKeyRef.current === categoryKey &&
          ensureDirectoryPath(normalizeFileBrowserPath(currentPathRef.current)) === requestPath
        ) {
          setItems(nextItems);
          setChildrenByPath(nextChildrenByPath);
        }
      } catch (error: any) {
        if (!isCurrentContext(context)) return;
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.error.loadFailed' }));
      } finally {
        if (isCurrentContext(context)) setLoading(false);
      }
    },
    [
      transferContext,
      isCurrentContext,
      clearChildDirectoryState,
      intl,
      markChildDirectoryCacheStale,
      resourceId,
      updateCategoryCache,
    ]
  );

  useEffect(() => {
    activeCategoryKeyRef.current = activeCategoryKey;
  }, [activeCategoryKey]);

  useEffect(() => {
    currentPathRef.current = currentPath;
  }, [currentPath]);

  useEffect(() => {
    isSearchingRef.current = isSearching;
  }, [isSearching]);

  useEffect(() => {
    const preferredCategoryKey = getDefaultFileCategoryKey(activeSessionId);
    const defaultCategoryKey = fileCategories.some((item) => item.key === preferredCategoryKey)
      ? preferredCategoryKey
      : fileCategories[0]?.key;
    if (!defaultCategoryKey) return;
    const defaultCategory = fileCategories.find((item) => item.key === defaultCategoryKey);
    const defaultCategoryPath = defaultCategory
      ? getCategoryActivePath(defaultCategory, activeSessionId)
      : ROOT_FILE_PATH;
    const defaultExpandedKeys =
      defaultCategoryKey === 'session' && activeSessionId ? [getSessionFilePath(activeSessionId)] : [];
    setPathInitialized(false);
    categoryCacheRef.current = {};
    childCacheInvalidVersionRef.current = {};
    childCacheLoadedVersionRef.current = {};
    activeCategoryKeyRef.current = defaultCategoryKey;
    currentPathRef.current = defaultCategoryPath;
    setActiveCategoryKey(defaultCategoryKey);
    setCurrentPath(defaultCategoryPath);
    setItems([]);
    setSearchItems([]);
    setSearchValue('');
    setIsSearching(false);
    clearChildDirectoryState();
    setExpandedTreeKeys(defaultExpandedKeys);
    if (!resourceId) return;
    setPathInitialized(true);
  }, [activeSessionId, clearChildDirectoryState, fileCategories, resourceId]);

  useEffect(() => {
    if (resourceId && pathInitialized && activeCategoryKey && currentPath) {
      const pendingSwitch = categorySwitchRequestRef.current;
      if (pendingSwitch) {
        const normalizedCurrentPath = ensureDirectoryPath(normalizeFileBrowserPath(currentPath));
        if (activeCategoryKey !== pendingSwitch.key || normalizedCurrentPath !== pendingSwitch.path) {
          return;
        }
        categorySwitchRequestRef.current = null;
        return;
      }
      void fetchList(currentPath);
    }
  }, [activeCategoryKey, activeSessionId, currentPath, fetchList, pathInitialized, resourceId]);

  useEffect(() => {
    if (!activeCategory || !pathInitialized) return;
    const nextPath = getCategoryActivePath(activeCategory, activeSessionId);
    if (ensureDirectoryPath(normalizeFileBrowserPath(currentPathRef.current)) === nextPath) return;
    currentPathRef.current = nextPath;
    setCurrentPath(nextPath);
  }, [activeCategory, activeSessionId, pathInitialized]);

  const handleCategoryChange = useCallback(
    async (key: string | string[]) => {
      const nextKey = Array.isArray(key) ? key[0] : key;
      if (!nextKey) {
        categorySwitchRequestRef.current = null;
        activeCategoryKeyRef.current = undefined;
        currentPathRef.current = '';
        setActiveCategoryKey(undefined);
        setCurrentPath('');
        setSearchValue('');
        setIsSearching(false);
        setSearchItems([]);
        setItems([]);
        clearChildDirectoryState();
        setExpandedTreeKeys([]);
        return;
      }
      const nextCategory = fileCategories.find((item) => item.key === nextKey);
      if (!nextCategory) return;
      const nextCategoryPath = getCategoryActivePath(nextCategory, activeSessionId);
      categorySwitchRequestRef.current = {
        key: nextCategory.key,
        path: ensureDirectoryPath(normalizeFileBrowserPath(nextCategoryPath)),
      };

      // Clear cache so switching tabs always reloads the data.
      delete categoryCacheRef.current[nextCategory.key];
      resetChildDirectoryCacheVersion(nextCategory.key);

      setActiveCategoryKey(nextCategory.key);
      setSearchValue('');
      setIsSearching(false);
      setSearchItems([]);
      setItems([]);
      clearChildDirectoryState();
      setExpandedTreeKeys(
        nextCategory.key === 'session' && activeSessionId ? [getSessionFilePath(activeSessionId)] : []
      );
      activeCategoryKeyRef.current = nextCategory.key;
      currentPathRef.current = nextCategoryPath;
      setCurrentPath(nextCategoryPath);
      await fetchList(nextCategoryPath, { force: true, categoryKey: nextCategory.key });
    },
    [
      activeSessionId,
      clearChildDirectoryState,
      fetchList,
      fileCategories,
      intl,
      resetChildDirectoryCacheVersion,
      resourceId,
    ]
  );

  // 回答完成后仅刷新当前目录；子树在用户再次展开时加载。
  useEffect(() => {
    let refreshTimer: number | null = null;

    const scheduleRefresh = (payload?: any) => {
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
      }
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void refreshCurrentDirectory(payload);
      }, 500);
    };

    const isForActiveSession = (payload?: any) => {
      const payloadSessionId = getMessagePayloadSessionId(payload);
      return !(payloadSessionId && activeSessionId && payloadSessionId !== activeSessionId);
    };

    const handleAnswerCompleted = (payload: any) => {
      if (isForActiveSession(payload)) {
        scheduleRefresh(payload);
      }
    };

    const handleSessionFilesUpdated = (payload: any) => {
      scheduleRefresh(payload);
    };

    EventEmitter.on('chat-answer-completed', handleAnswerCompleted);
    EventEmitter.on('fileBrowser-session-files-updated', handleSessionFilesUpdated);
    return () => {
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
      }
      EventEmitter.off('chat-answer-completed', handleAnswerCompleted);
      EventEmitter.off('fileBrowser-session-files-updated', handleSessionFilesUpdated);
    };
  }, [EventEmitter, activeSessionId, refreshCurrentDirectory]);

  const sortedSearchItems = useMemo(() => {
    return sortFileBrowserItems(searchItems);
  }, [searchItems]);

  const uploadDirectoryBrowseRootPath = useMemo(() => {
    return getParentDirectoryPath(uploadDirectoryBasePath || pendingUploadPath || currentPath || ROOT_FILE_PATH);
  }, [currentPath, pendingUploadPath, uploadDirectoryBasePath]);

  const uploadDirectoryBreadcrumb = useMemo(() => {
    return buildScopedFolderPath(uploadDirectoryPath, uploadDirectoryBrowseRootPath);
  }, [uploadDirectoryBrowseRootPath, uploadDirectoryPath]);

  const canConfirmUploadDirectory = useMemo(() => {
    return isAllowedUploadDirectoryTarget(uploadDirectoryPath, uploadDirectoryBasePath);
  }, [uploadDirectoryBasePath, uploadDirectoryPath]);

  const loadUploadDirectoryFolders = useCallback(
    async (directoryPath: string) => {
      const context = transferContext;
      if (!isCurrentContext(context)) return;
      const normalizedPath = ensureDirectoryPath(directoryPath || '/');
      setUploadDirectoryLoading(true);
      try {
        const response = await listFiles({ resourceId, path: normalizedPath, sort: PROCESS_FILE_LIST_SORT });
        if (!isCurrentContext(context)) return;
        setUploadDirectoryFolders(unwrapListResponse<FileBrowserItem>(response).filter((item) => isDirectory(item)));
        setUploadDirectoryPath(normalizedPath);
      } catch (error: any) {
        if (!isCurrentContext(context)) return;
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.error.loadFailed' }));
      } finally {
        if (isCurrentContext(context)) setUploadDirectoryLoading(false);
      }
    },
    [transferContext, isCurrentContext, intl, resourceId]
  );

  const handleSearch = useCallback(
    async (keyword: string) => {
      const context = transferContext;
      if (!isCurrentContext(context)) return;
      const nextKeyword = keyword.trim();
      setSearchValue(nextKeyword);
      if (!nextKeyword) {
        searchRequestSeqRef.current += 1;
        setIsSearching(false);
        setSearchItems([]);
        clearChildDirectoryState();
        await fetchList(currentPath, { force: true });
        return;
      }
      const requestSeq = ++searchRequestSeqRef.current;
      fetchListRequestSeqRef.current += 1;
      setIsSearching(true);
      clearChildDirectoryState();
      setLoading(true);
      try {
        const visitedDirectories = new Set<string>();
        const resultMap = new Map<string, FileBrowserItem>();

        const collectSearchResults = async (path: string) => {
          const normalizedPath = ensureDirectoryPath(normalizeFileBrowserPath(path || ROOT_FILE_PATH));
          if (!isCurrentContext(context) || visitedDirectories.has(normalizedPath)) {
            return;
          }
          visitedDirectories.add(normalizedPath);

          const res: any = await searchFiles({ resourceId, path: normalizedPath, keyword: nextKeyword });
          if (!isCurrentContext(context)) return;
          const list = unwrapListResponse<FileBrowserItem>(res);
          list.forEach((item) => {
            if (item?.path) {
              resultMap.set(item.path, item);
            }
          });

          for (const item of list) {
            if (isDirectory(item)) {
              await collectSearchResults(item.path);
            }
          }
        };

        await collectSearchResults(ROOT_FILE_PATH);
        if (isCurrentContext(context) && requestSeq === searchRequestSeqRef.current) {
          setSearchItems(Array.from(resultMap.values()));
        }
      } catch (error: any) {
        if (!isCurrentContext(context)) return;
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.error.loadFailed' }));
      } finally {
        if (isCurrentContext(context) && requestSeq === searchRequestSeqRef.current) {
          setLoading(false);
        }
      }
    },
    [transferContext, isCurrentContext, clearChildDirectoryState, currentPath, fetchList, intl, resourceId]
  );

  const clearClickTimer = useCallback(() => {
    if (clickTimerRef.current !== null) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
  }, []);

  const {
    copyModalOpen,
    copyTargetType,
    copyTargetName,
    copyDirectoryPath,
    copyFolderPath,
    copyFolders,
    copyFolderLoading,
    copyingToFileBrowser,
    loadCopyFolders,
    openCopyToFileBrowser,
    handleConfirmCopyToFileBrowser,
    handleCancelCopyToFileBrowser,
  } = useCopyToFileBrowser({
    resourceId,
    activeSessionId,
    expandedTreeKeys,
    getActiveCategoryKey: () => activeCategoryKeyRef.current,
    refreshExpandedDirectories: refreshCurrentDirectory,
    clearClickTimer,
  });

  const {
    saveModalOpen,
    knowledgeKeyword,
    knowledgeBases,
    knowledgeLoading,
    selectedKnowledgeBase,
    knowledgeDirectoryPath,
    knowledgeFolders,
    knowledgeFolderLoading,
    savingToKnowledge,
    knowledgeUploadConfirmOpen,
    pendingKnowledgeUploads,
    pendingKnowledgeConflicts,
    pendingKnowledgeDirectoryPath,
    openSaveToKnowledge,
    setKnowledgeKeyword,
    loadKnowledgeBases,
    loadKnowledgeFolders,
    loadKnowledgeFolderChildren,
    handleSelectKnowledgeBase,
    handleConfirmSaveToKnowledge,
    handleConfirmKnowledgeUpload,
    handleCancelKnowledgeUpload,
    handleCancelSaveToKnowledge,
  } = useSaveToKnowledge({
    resourceId,
    clearClickTimer,
  });

  const { handlePreview, handleDownload } = useFilePreviewActions({
    resourceId,
    EventEmitter,
    previewClassName: styles.previewContent,
  });

  const resolveKnowledgeUploadTarget = useCallback(
    async (targetPath: string): Promise<BykcKnowledgeUploadTarget | null> => {
      const context = transferContext;
      if (!isCurrentContext(context)) return null;
      const response = await queryDigEmployeeManageKnowledgeResourceAuth({
        resourceId,
        pageNum: 1,
        pageSize: 100,
        keyword: '',
      });
      if (!isCurrentContext(context)) return null;
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
    [transferContext, isCurrentContext, intl, resourceId]
  );

  const skillUploadTailRef = useRef<Promise<unknown>>(Promise.resolve());
  const uploadOneFile = useCallback(
    async (task: FileTransferTask, report: (event: any) => void) => {
      const destination = task.context;
      if (!destination || !isCurrentContext(destination))
        throw new Error(intl.formatMessage({ id: 'fileBrowser.upload.failed' }));
      if (task.knowledge) {
        const form = new FormData();
        form.append('files', task.file);
        form.append('resourceId', String(task.knowledge.resourceId));
        form.append('directoryPath', task.knowledge.directoryPath);
        form.append('processFrontMatter', String(task.knowledge.processFrontMatter));
        form.append('overwrite', String(task.overwrite));
        const result = await uploadKnowledgeFiles(form, {
          responseCfg: { hideErrorTips: true },
          onUploadProgress: (event) =>
            report({
              loaded: event.loaded || 0,
              total: event.total || task.file.size,
              phase: event.total && event.loaded >= event.total ? 'processing' : 'uploading',
              fileName: task.file.name,
            }),
        });
        if (Number(result?.summary?.failed || 0) > 0) {
          throw new Error(result?.failedItems?.[0]?.error || intl.formatMessage({ id: 'fileBrowser.upload.failed' }));
        }
        if (isCurrentContext(destination) && result?.postProcessErrors?.length) {
          message.warning(
            `${task.file.name}: ${intl.formatMessage(
              { id: 'knowledgeDetail.uploadPostProcessWarning' },
              { count: result.postProcessErrors.length }
            )}`
          );
        }
        return;
      }
      const send = () => {
        if (!isCurrentContext(destination)) throw new Error(intl.formatMessage({ id: 'fileBrowser.upload.failed' }));
        return uploadFiles(
          destination.resourceId,
          task.path,
          [task.file],
          (event) =>
            report({
              loaded: event.loaded || 0,
              total: event.total || task.file.size,
              phase: event.phase || 'uploading',
              fileName: task.file.name,
              resumed: event.resumed,
            }),
          undefined,
          {
            ownerKey: destination.ownerKey,
            overwrite: task.overwrite,
            checkContext: () => {
              task.checkActive?.();
              if (!isCurrentContext(destination))
                throw new Error(intl.formatMessage({ id: 'fileBrowser.upload.failed' }));
            },
          }
        );
      };
      if (task.file.name.toLowerCase().endsWith('.zip')) {
        // Skill registrations share the employee relation; keep their existing serial mutation order.
        const running = skillUploadTailRef.current.catch(() => undefined).then(send);
        skillUploadTailRef.current = running;
        return running;
      }
      return send();
    },
    [intl, isCurrentContext]
  );
  const fileTransfers = useFileTransferQueue(uploadOneFile, transferContext.key);

  const executeUpload = useCallback(
    async (targetPath: string, fileList: File[], processFrontMatter = false) => {
      const context = pendingUploadContextRef.current || transferContext;
      if (!isCurrentContext(context)) return;
      if (!fileList.length || uploadingFiles) return;
      const uploadPath = ensureDirectoryPath(targetPath || currentPath || '/');
      uploadRunCountRef.current += 1;
      setUploadingFiles(true);
      try {
        const knowledgeTarget = isPathIn(uploadPath, BYKC_FILE_PATH)
          ? pendingUploadKnowledgeTarget || (await resolveKnowledgeUploadTarget(uploadPath))
          : null;
        if (!isCurrentContext(context)) return;
        if (isPathIn(uploadPath, BYKC_FILE_PATH) && !knowledgeTarget) return;
        const previousRows = fileTransfers.rows;
        let allSucceeded: boolean;
        if (
          previousRows.length &&
          previousRows.every((row) => row.path === uploadPath) &&
          previousRows.length === fileList.length &&
          previousRows.every((row, index) => row.file === fileList[index])
        ) {
          const failedRows = previousRows.filter((row) => row.status === 'failed');
          const outcomes = await Promise.all(failedRows.map((row) => fileTransfers.retry(row.id)));
          allSucceeded = outcomes.every(Boolean);
        } else {
          let knowledge: FileTransferTask['knowledge'];
          if (knowledgeTarget)
            knowledge = {
              resourceId: knowledgeTarget.knowledgeBase.resourceId,
              directoryPath: knowledgeTarget.directoryPath,
              processFrontMatter,
            };
          const tasks = fileList.map((file) => ({
            id: `file-${++uploadIdentityRef.current}`,
            file,
            path: uploadPath,
            overwrite: pendingUploadConflicts.length > 0,
            knowledge,
            context,
          }));
          allSucceeded = await fileTransfers.start(tasks);
        }
        if (!isCurrentContext(context)) return;
        if (!allSucceeded) {
          message.error(intl.formatMessage({ id: 'fileBrowser.upload.partialFailed' }));
          await fetchList(currentPath, { force: true });
          return;
        }
        message.success(intl.formatMessage({ id: 'fileBrowser.upload.success' }));
        setUploadConfirmOpen(false);
        setPendingUploadFiles([]);
        setPendingUploadPath('');
        setPendingUploadConflicts([]);
        setPendingUploadKnowledgeTarget(null);
        if (uploadPath === ensureDirectoryPath(currentPath)) {
          setSearchValue('');
          setIsSearching(false);
          clearChildDirectoryState();
          await fetchList(currentPath, { force: true });
          return;
        }
        const res: any = await listFiles({ resourceId, path: uploadPath, sort: PROCESS_FILE_LIST_SORT });
        if (!isCurrentContext(context)) return;
        markChildDirectoriesFresh(activeCategoryKey, [uploadPath]);
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
        if (!isCurrentContext(context)) return;
        const errorMessage =
          (typeof error === 'string' ? error : undefined) ||
          error?.response?.data?.msg ||
          error?.data?.msg ||
          error?.msg ||
          error?.message;
        message.error(errorMessage || intl.formatMessage({ id: 'fileBrowser.upload.failed' }));
      } finally {
        if (isCurrentContext(context)) {
          uploadRunCountRef.current -= 1;
          setUploadingFiles(uploadRunCountRef.current > 0);
        }
      }
    },
    [
      transferContext,
      isCurrentContext,
      activeCategoryKey,
      clearChildDirectoryState,
      currentPath,
      resolveKnowledgeUploadTarget,
      fetchList,
      intl,
      isSearching,
      items,
      markChildDirectoriesFresh,
      pendingUploadConflicts.length,
      pendingUploadKnowledgeTarget,
      resourceId,
      updateCategoryCache,
      uploadingFiles,
      fileTransfers,
    ]
  );

  const refreshFileBrowserDirectory = useCallback(
    async (directoryPath: string) => {
      const normalizedPath = ensureDirectoryPath(directoryPath || ROOT_FILE_PATH);
      if (isPathIn(normalizedPath, SHARED_FILE_PATH)) {
        delete categoryCacheRef.current.shared;
        resetChildDirectoryCacheVersion('shared');
      }
      if (normalizedPath === ensureDirectoryPath(currentPath)) {
        setSearchValue('');
        setIsSearching(false);
        // 重新拉取根级与所有已展开目录，避免清空已展开目录的子级数据
        await refreshCurrentDirectory();
        return;
      }
      const res: any = await listFiles({ resourceId, path: normalizedPath });
      const directoryChildren = unwrapListResponse<FileBrowserItem>(res);
      markChildDirectoriesFresh(activeCategoryKey, [normalizedPath]);
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
    [
      activeCategoryKey,
      currentPath,
      isSearching,
      items,
      markChildDirectoriesFresh,
      refreshCurrentDirectory,
      resetChildDirectoryCacheVersion,
      resourceId,
      updateCategoryCache,
    ]
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
        const errorMessage =
          (typeof error === 'string' ? error : undefined) ||
          error?.response?.data?.error_description ||
          error?.response?.data?.msg ||
          error?.data?.error_description ||
          error?.data?.msg ||
          error?.error_description ||
          error?.msg ||
          error?.message;
        message.error(errorMessage || intl.formatMessage({ id: 'fileBrowser.rename.failed' }));
      } finally {
        setRenameLoading(false);
      }
    },
    [currentPath, fetchList, intl, refreshFileBrowserDirectory, renameTarget, resourceId]
  );

  const handleUploadSelect = useCallback(
    async (targetPath: string, fileList: File[]) => {
      const context = transferContext;
      if (!isCurrentContext(context)) return;
      if (!fileList.length || uploadingFiles) return;
      fileTransfers.reset();
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
        } else {
          const response = await listFiles({ resourceId, path: uploadPath });
          const existingNames = new Set(unwrapListResponse<FileBrowserItem>(response).map((item) => item.name));
          uploadConflicts = fileList.filter((file) => existingNames.has(file.name)).map((file) => file.name);
        }

        if (!isCurrentContext(context)) return;
        pendingUploadContextRef.current = context;
        setPendingUploadPath(uploadPath);
        setPendingUploadFiles(fileList);
        setPendingUploadConflicts(uploadConflicts);
        setPendingUploadKnowledgeTarget(uploadKnowledgeTarget);
        setUploadConfirmOpen(true);
      } catch (error: any) {
        if (!isCurrentContext(context)) return;
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.upload.failed' }));
      }
    },
    [
      transferContext,
      isCurrentContext,
      fileTransfers.reset,
      intl,
      resolveKnowledgeUploadTarget,
      resourceId,
      uploadingFiles,
    ]
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
    setUploadDirectoryPickerOpen(false);
    void handleUploadSelect(ensureDirectoryPath(uploadDirectoryPath || ROOT_FILE_PATH), pendingUploadFiles);
  }, [handleUploadSelect, intl, pendingUploadFiles, uploadDirectoryBasePath, uploadDirectoryPath]);

  const handleCategoryUploadSelect = useCallback(
    async (category: FileCategoryItem, fileList: File[]) => {
      const context = transferContext;
      if (!isCurrentContext(context)) return;
      if (!fileList.length) return;
      const categoryPath = getCategoryActivePath(category, activeSessionId);
      try {
        if (category.key !== 'root') {
          await ensureFolder({ resourceId, path: categoryPath });
        }
        if (!isCurrentContext(context)) return;
        await handleUploadSelect(categoryPath, fileList);
      } catch (error: any) {
        if (!isCurrentContext(context)) return;
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.createFolder.failed' }));
      }
    },
    [transferContext, isCurrentContext, activeSessionId, handleUploadSelect, intl, resourceId]
  );

  const handleRefreshCategory = useCallback(
    async (category: FileCategoryItem) => {
      const categoryPath = getCategoryActivePath(category, activeSessionId);
      try {
        if (category.key !== activeCategoryKeyRef.current) {
          // 刷新非当前分类没有展开态可保留，按整分类重建最简单。
          delete categoryCacheRef.current[category.key];
          resetChildDirectoryCacheVersion(category.key);
          await fetchList(categoryPath, { force: true, categoryKey: category.key });
          return;
        }
        // Refresh this directory once and invalidate its subtree instead of listing every expanded child.
        setSearchValue('');
        setIsSearching(false);
        await refreshCurrentDirectory();
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.error.loadFailed' }));
      }
    },
    [activeSessionId, fetchList, intl, refreshCurrentDirectory, resetChildDirectoryCacheVersion, resourceId]
  );

  useEffect(() => {
    const handler = (payload?: { key?: string }) => {
      if (payload?.key !== 'file') return;
      const currentCategoryKey = activeCategoryKeyRef.current;
      const currentCategory = fileCategories.find((item) => item.key === currentCategoryKey);
      if (currentCategory) {
        void handleRefreshCategory(currentCategory);
      }
    };

    EventEmitter.on('sider-menu-tab-click-refresh', handler);
    return () => {
      EventEmitter.off('sider-menu-tab-click-refresh', handler);
    };
  }, [EventEmitter, fileCategories, handleRefreshCategory]);

  const openCategoryPath = useCallback(
    async (category: FileCategoryItem, path: string) => {
      const context = transferContext;
      if (!isCurrentContext(context)) return;
      const categoryPath = ensureDirectoryPath(path || getCategoryActivePath(category, activeSessionId));
      try {
        setLoading(true);
        delete categoryCacheRef.current[category.key];
        resetChildDirectoryCacheVersion(category.key);
        if (activeCategoryKeyRef.current !== category.key || currentPathRef.current !== categoryPath) {
          categorySwitchRequestRef.current = { key: category.key, path: categoryPath };
        }
        setActiveCategoryKey(category.key);
        activeCategoryKeyRef.current = category.key;
        currentPathRef.current = categoryPath;
        setCurrentPath(categoryPath);
        setSearchValue('');
        setIsSearching(false);
        setSearchItems([]);
        setItems([]);
        clearChildDirectoryState();
        setExpandedTreeKeys([]);
        const response = await listFiles({ resourceId, path: categoryPath, sort: PROCESS_FILE_LIST_SORT });
        if (!isCurrentContext(context) || currentPathRef.current !== categoryPath) return;
        const nextItems = unwrapListResponse<FileBrowserItem>(response);
        updateCategoryCache(category.key, { path: categoryPath, items: nextItems, childrenByPath: {} });
        setItems(nextItems);
      } catch (error: any) {
        if (isCurrentContext(context)) {
          message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.error.loadFailed' }));
        }
      } finally {
        if (isCurrentContext(context)) setLoading(false);
      }
    },
    [
      activeSessionId,
      clearChildDirectoryState,
      intl,
      isCurrentContext,
      resetChildDirectoryCacheVersion,
      resourceId,
      transferContext,
      updateCategoryCache,
    ]
  );

  const openCreateFolder = useCallback((parentPath: string) => {
    setCreateFolderParentPath(ensureDirectoryPath(parentPath || ROOT_FILE_PATH));
    setCreateFolderName('');
    setCreateFolderError('');
    setCreateFolderOpen(true);
  }, []);

  const handleCreateFolderNameChange = useCallback((name: string) => {
    setCreateFolderName(name);
    setCreateFolderError('');
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
      const siblingRes = await listFiles({ resourceId, path: parentPath, sort: PROCESS_FILE_LIST_SORT });
      const hasDuplicateFolder = unwrapListResponse<FileBrowserItem>(siblingRes).some(
        (item) => isDirectory(item) && `${item.name || ''}`.trim() === folderName
      );
      if (hasDuplicateFolder) {
        setCreateFolderError(intl.formatMessage({ id: 'fileBrowser.createFolder.duplicateName' }));
        return;
      }
      await createFileBrowserFolder({
        resourceId,
        path: buildTargetFolderPath(parentPath, folderName),
      });
      message.success(intl.formatMessage({ id: 'fileBrowser.createFolder.success' }));
      setCreateFolderOpen(false);
      setCreateFolderName('');
      setCreateFolderError('');
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

  const childReadRequestsRef = useRef(new Map<string, Promise<void>>());

  const loadTreeNode = useCallback(
    async (node: FileTreeItem) => {
      const context = transferContext;
      if (!isCurrentContext(context) || !isDirectory(node)) return;
      const path = ensureDirectoryPath(node.path);
      if (!expandedTreeKeysRef.current.includes(path)) return;
      const activeRootPath = getCategoryRootPath(activeCategoryKey);
      if (activeCategoryKey !== 'root' && !isPathIn(path, activeRootPath)) return;
      if (childrenByPath[path] && !isChildDirectoryCacheStale(activeCategoryKey, path)) return;
      const version = activeCategoryKey ? childCacheInvalidVersionRef.current[activeCategoryKey] || 0 : 0;
      if (activeCategoryKey && childCacheLoadedVersionRef.current[activeCategoryKey]?.[path] === version) return;
      const requestKey = JSON.stringify([context.key, activeCategoryKey, version, path]);
      const pending = childReadRequestsRef.current.get(requestKey);
      if (pending) return pending;
      const request = (async () => {
        try {
          const res: any = await listFiles({ resourceId, path, sort: PROCESS_FILE_LIST_SORT });
          if (
            !isCurrentContext(context) ||
            activeCategoryKeyRef.current !== activeCategoryKey ||
            !expandedTreeKeysRef.current.includes(path) ||
            (activeCategoryKey && (childCacheInvalidVersionRef.current[activeCategoryKey] || 0) !== version)
          ) {
            return;
          }
          markChildDirectoriesFresh(activeCategoryKey, [path]);
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
          if (isCurrentContext(context) && activeCategoryKeyRef.current === activeCategoryKey) {
            message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.error.loadFailed' }));
          }
        }
      })();
      childReadRequestsRef.current.set(requestKey, request);
      try {
        await request;
      } finally {
        if (childReadRequestsRef.current.get(requestKey) === request) childReadRequestsRef.current.delete(requestKey);
      }
    },
    [
      activeCategoryKey,
      childrenByPath,
      currentPath,
      intl,
      isChildDirectoryCacheStale,
      isSearching,
      items,
      markChildDirectoriesFresh,
      isCurrentContext,
      transferContext,
      resourceId,
      updateCategoryCache,
    ]
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
        type: isDirectory(item) ? DragType.commonFolder : DragType.commonFile,
      });
    },
    [EventEmitter, clearClickTimer, resourceId]
  );

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
  } else {
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

  const getFileActionItems = useCallback(
    (item: FileBrowserItem) => {
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
        ...(dir ? (['upload', 'createFolder', 'createSiblingFolder'] as FileActionKey[]) : []),
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
            createFolder: 'fileBrowser.action.newSubFolder',
            createSiblingFolder: 'fileBrowser.action.newSiblingFolder',
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

  const getSearchFileActionItems = useCallback(
    (item: FileBrowserItem) => [
      {
        key: 'locate',
        label: (
          <div className={employeeStyles.dropdownMenuItem}>
            {intl.formatMessage({ id: 'fileBrowser.action.locate' })}
          </div>
        ),
      },
      ...getFileActionItems(item),
    ],
    [getFileActionItems, intl]
  );

  const handleLocateSearchResult = useCallback(
    async (item: FileBrowserItem) => {
      const nextCategoryKey = getFileCategoryKeyByPath(item.path);
      const nextCategory = fileCategories.find((category) => category.key === nextCategoryKey);
      if (!nextCategory) return;

      const parentPath = getParentDirectoryPath(item.path);
      setSearchValue('');
      setIsSearching(false);
      await openCategoryPath(nextCategory, parentPath);
    },
    [fileCategories, openCategoryPath]
  );

  const handleFileAction = useCallback(
    (key: React.Key, item: FileBrowserItem) => {
      if (key === 'locate') {
        void handleLocateSearchResult(item);
      } else if (key === 'preview') {
        void handlePreview(item);
      } else if (key === 'download') {
        void handleDownload(item);
      } else if (key === 'rename') {
        setRenameTarget(item);
        setRenameOpen(true);
      } else if (key === 'delete') {
        Modal.confirm({
          title: intl.formatMessage({ id: 'fileBrowser.delete.confirm' }),
          content: intl.formatMessage({ id: 'fileBrowser.delete.confirmName' }, { name: item.name }),
          onOk: () => handleDeleteFileBrowserItem(item),
        });
      } else if (key === 'createFolder') {
        openCreateFolder(ensureDirectoryPath(item.path));
      } else if (key === 'createSiblingFolder') {
        openCreateFolder(getParentDirectoryPath(item.path));
      } else if (key === 'saveToKnowledge') {
        openSaveToKnowledge(item);
      } else if (key === 'saveToSessionFiles') {
        openCopyToFileBrowser(item, 'session');
      } else if (key === 'saveToSharedFiles') {
        openCopyToFileBrowser(item, 'shared');
      }
    },
    [
      handleDeleteFileBrowserItem,
      handleDownload,
      handleLocateSearchResult,
      handlePreview,
      intl,
      openCopyToFileBrowser,
      openCreateFolder,
      openSaveToKnowledge,
    ]
  );

  const handleExitSearch = useCallback(() => {
    void handleSearch('');
  }, [handleSearch]);

  const searchListContent = (
    <SearchResultList
      items={sortedSearchItems}
      loading={loading}
      searchValue={searchValue}
      onExitSearch={handleExitSearch}
      onItemDoubleClick={handleItemDoubleClick}
      onPreview={handlePreview}
      getActionItems={getSearchFileActionItems}
      onAction={handleFileAction}
    />
  );

  const fileTreeContent = (
    <FileTreeList
      items={items}
      childrenByPath={childrenByPath}
      expandedKeys={expandedTreeKeys}
      loadedKeys={loadedTreeKeys}
      currentPath={currentPath}
      loading={loading}
      emptyText={intl.formatMessage({ id: 'fileBrowser.empty' })}
      onExpand={setExpandedTreeKeys}
      onLoadData={loadTreeNode}
      onNodeClick={handleTreeNodeClick}
      onNodeDoubleClick={handleItemDoubleClick}
      getActionItems={getFileActionItems}
      onAction={handleFileAction}
    />
  );

  const retryUploadFile = async (id: string) => {
    const context = fileTransfers.rows.find((row) => row.id === id)?.context;
    if (!context || !isCurrentContext(context)) return;
    uploadRunCountRef.current += 1;
    setUploadingFiles(true);
    try {
      const succeeded = await fileTransfers.retry(id);
      if (succeeded && isCurrentContext(context)) await fetchList(currentPath, { force: true });
    } finally {
      if (isCurrentContext(context)) {
        uploadRunCountRef.current -= 1;
        setUploadingFiles(uploadRunCountRef.current > 0);
      }
    }
  };

  const uploadProgressRows = fileTransfers.rows.map((row) => {
    let label = intl.formatMessage({ id: `fileBrowser.upload.${row.progress.phase}` }, { name: row.file.name });
    if (row.status === 'pending') label = intl.formatMessage({ id: 'fileBrowser.upload.queued' });
    if (row.status === 'success') label = intl.formatMessage({ id: 'fileBrowser.upload.success' });
    return {
      id: row.id,
      name: row.file.name,
      percent: Math.min(100, Math.floor((row.progress.loaded / Math.max(1, row.progress.total)) * 100)),
      label,
      status: row.status,
      hint: row.error || (row.progress.resumed ? intl.formatMessage({ id: 'fileBrowser.upload.resumed' }) : undefined),
    };
  });

  let retryProgressRow: ((id: string) => void) | undefined;
  if (!isKnowledgeUploadConfirm) {
    retryProgressRow = (id) => {
      void retryUploadFile(id);
    };
  }

  return (
    <div className={styles.miniList}>
      <UnfinishedUploads
        onCancelQueued={fileTransfers.cancelQueued}
        ownerKey={transferContext.ownerKey}
        resourceId={transferContext.resourceId}
        disabled={uploadingFiles}
      />
      <Input
        allowClear
        value={searchValue}
        suffix={<SearchOutlined onClick={() => handleSearch(searchValue)} />}
        placeholder={intl.formatMessage({ id: 'fileBrowser.toolbar.search' })}
        onChange={(event) => {
          const nextValue = event.target.value;
          setSearchValue(nextValue);
          if (!nextValue.trim() && isSearching) {
            void handleSearch('');
          }
        }}
        onPressEnter={() => handleSearch(searchValue)}
      />
      {isSearching ? (
        searchListContent
      ) : (
        <Collapse
          accordion
          activeKey={activeCategoryKey ? [activeCategoryKey] : []}
          onChange={handleCategoryChange}
          className={styles.categoryCollapse}
          items={fileCategories.map((category) => ({
            key: category.key,
            className: category.key === activeCategoryKey ? styles.categoryItemActive : undefined,
            label: (
              <FileCategoryHeader
                category={category}
                activeCategoryKey={activeCategoryKey}
                activeSessionId={activeSessionId}
                currentPath={currentPath}
                title={intl.formatMessage({ id: category.titleId })}
                onUploadSelect={(targetCategory, fileList) => {
                  void handleCategoryUploadSelect(targetCategory, fileList);
                }}
                onCreateFolder={openCreateFolder}
                onRefresh={(targetCategory) => {
                  void handleRefreshCategory(targetCategory);
                }}
                onOpenPath={(targetCategory, path) => {
                  void openCategoryPath(targetCategory, path);
                }}
                onCopyPath={handleCopyCategoryPath}
              />
            ),
            children: category.key === activeCategoryKey ? fileTreeContent : null,
          }))}
        />
      )}
      <FileMiniListModals
        uploadConfirmOpen={uploadConfirmOpen}
        knowledgeUploadConfirmOpen={knowledgeUploadConfirmOpen}
        uploadConfirmFiles={uploadConfirmFiles}
        uploadConfirmDirectoryPath={uploadConfirmDirectoryPath}
        uploadConfirmConflicts={uploadConfirmConflicts}
        uploadConfirmLoading={uploadConfirmLoading}
        uploadProgressRows={isKnowledgeUploadConfirm ? [] : uploadProgressRows}
        onRetryUploadFile={retryProgressRow}
        showProcessFrontMatter={isKnowledgeUploadConfirm || isBykcUploadConfirm}
        uploadConfirmOkText={uploadConfirmOkText}
        onUploadDirectoryAction={isKnowledgeUploadConfirm ? undefined : openUploadDirectoryPicker}
        onUploadConfirmOk={handleUploadConfirmOk}
        onUploadConfirmCancel={handleUploadConfirmCancel}
        createFolderOpen={createFolderOpen}
        createFolderName={createFolderName}
        createFolderError={createFolderError}
        creatingFolder={creatingFolder}
        onCreateFolderNameChange={handleCreateFolderNameChange}
        onCreateFolderOk={handleCreateFolder}
        onCreateFolderCancel={() => {
          if (creatingFolder) return;
          setCreateFolderOpen(false);
          setCreateFolderParentPath('');
          setCreateFolderName('');
          setCreateFolderError('');
        }}
        renameOpen={renameOpen}
        renameTargetName={renameTarget?.name || ''}
        renameLoading={renameLoading}
        onRenameOk={handleRenameOk}
        onRenameCancel={() => {
          if (renameLoading) return;
          setRenameOpen(false);
          setRenameTarget(null);
        }}
        uploadDirectoryPickerOpen={uploadDirectoryPickerOpen}
        uploadDirectoryPath={uploadDirectoryPath}
        uploadDirectoryBasePath={uploadDirectoryBasePath}
        uploadDirectoryBreadcrumb={uploadDirectoryBreadcrumb}
        uploadDirectoryFolders={uploadDirectoryFolders}
        uploadDirectoryLoading={uploadDirectoryLoading}
        canConfirmUploadDirectory={canConfirmUploadDirectory}
        onUploadDirectoryOk={handleConfirmUploadDirectory}
        onUploadDirectoryCancel={() => {
          if (uploadDirectoryLoading) return;
          setUploadDirectoryPickerOpen(false);
          setUploadDirectoryBasePath('/');
        }}
        onLoadUploadDirectoryFolders={(path) => {
          void loadUploadDirectoryFolders(path);
        }}
        copyModalOpen={copyModalOpen}
        copyTargetType={copyTargetType}
        copyTargetName={copyTargetName}
        copyDirectoryPath={copyDirectoryPath}
        copyFolderPath={copyFolderPath}
        copyFolders={copyFolders}
        copyFolderLoading={copyFolderLoading}
        copyingToFileBrowser={copyingToFileBrowser}
        onCopyOk={handleConfirmCopyToFileBrowser}
        onCopyCancel={handleCancelCopyToFileBrowser}
        onLoadCopyFolders={(path) => {
          void loadCopyFolders(path);
        }}
        saveModalOpen={saveModalOpen}
        savingToKnowledge={savingToKnowledge}
        knowledgeKeyword={knowledgeKeyword}
        onKnowledgeKeywordChange={setKnowledgeKeyword}
        onKnowledgeSearch={(keyword) => loadKnowledgeBases(keyword)}
        knowledgeBases={knowledgeBases}
        knowledgeLoading={knowledgeLoading}
        selectedKnowledgeBase={selectedKnowledgeBase}
        onSelectKnowledgeBase={handleSelectKnowledgeBase}
        knowledgeDirectoryPath={knowledgeDirectoryPath}
        knowledgeFolders={knowledgeFolders}
        knowledgeFolderLoading={knowledgeFolderLoading}
        onKnowledgeFolderClick={(directoryPath) => {
          if (selectedKnowledgeBase) {
            void loadKnowledgeFolders(selectedKnowledgeBase, directoryPath);
          }
        }}
        onLoadKnowledgeFolderChildren={(directoryPath) => {
          if (selectedKnowledgeBase) {
            return loadKnowledgeFolderChildren(selectedKnowledgeBase, directoryPath);
          }
          return Promise.resolve([]);
        }}
        onSaveToKnowledgeOk={handleConfirmSaveToKnowledge}
        onSaveToKnowledgeCancel={handleCancelSaveToKnowledge}
      />
    </div>
  );
};

export default FileMiniList;
