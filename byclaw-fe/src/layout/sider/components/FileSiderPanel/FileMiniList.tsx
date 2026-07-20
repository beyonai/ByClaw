import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Collapse, Input, Modal, Upload, message } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import type { UploadConfirmFile } from '@/components/UploadConfirmModal';
import { DragType } from '@/components/QueryInput/withDrag';
import employeeStyles from '@/layout/sider/components/EmployeeList/index.module.less';
import useGlobal from '@/hooks/useGlobal';
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
import {
  BYKC_FILE_PATH,
  LOG_FILE_PATH,
  ROOT_FILE_PATH,
  SESSION_FILE_PATH,
  SHARED_FILE_PATH,
  type FileActionKey,
  type FileCategoryItem,
  type FileCategoryKey,
  type FileTreeItem,
} from './constants';
import {
  buildDirectoryPathChain,
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
  const [expandedTreeKeys, setExpandedTreeKeys] = useState<React.Key[]>([]);
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

  const resetChildDirectoryCacheVersion = useCallback((categoryKey: FileCategoryKey | undefined) => {
    if (!categoryKey) return;
    delete childCacheInvalidVersionRef.current[categoryKey];
    delete childCacheLoadedVersionRef.current[categoryKey];
  }, []);

  const markChildDirectoryCacheStale = useCallback((categoryKey: FileCategoryKey | undefined) => {
    if (!categoryKey) return;
    childCacheInvalidVersionRef.current[categoryKey] = (childCacheInvalidVersionRef.current[categoryKey] || 0) + 1;
  }, []);

  const markChildDirectoriesFresh = useCallback((categoryKey: FileCategoryKey | undefined, paths: string[]) => {
    if (!categoryKey || !paths.length) return;
    const loadedVersionMap = childCacheLoadedVersionRef.current[categoryKey] || {};
    const currentVersion = childCacheInvalidVersionRef.current[categoryKey] || 0;
    paths.forEach((path) => {
      loadedVersionMap[ensureDirectoryPath(normalizeFileBrowserPath(path))] = currentVersion;
    });
    childCacheLoadedVersionRef.current[categoryKey] = loadedVersionMap;
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
        const res: any = await listFiles({ resourceId, path: requestPath });
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
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.error.loadFailed' }));
      } finally {
        if (requestSeq === fetchListRequestSeqRef.current) {
          setLoading(false);
        }
      }
    },
    [activeCategoryKey, intl, resetChildDirectoryCacheVersion, resourceId, updateCategoryCache]
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
        markChildDirectoriesFresh('session', [sessionPath]);

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
    [activeSessionId, intl, isSearching, items, markChildDirectoriesFresh, resourceId, updateCategoryCache]
  );

  const refreshExpandedDirectories = useCallback(
    async (payload?: { sessionId?: string }) => {
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
        markChildDirectoriesFresh(categoryKey, expandedDirectoryPaths);

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
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.error.loadFailed' }));
      } finally {
        setLoading(false);
      }
    },
    [expandedTreeKeys, intl, markChildDirectoriesFresh, markChildDirectoryCacheStale, resourceId, updateCategoryCache]
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
    const defaultCategoryKey = getDefaultFileCategoryKey(activeSessionId);
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
    setChildrenByPath({});
    setExpandedTreeKeys(defaultExpandedKeys);
    if (!resourceId) return;
    setPathInitialized(true);
  }, [activeSessionId, fileCategories, resourceId]);

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
        setChildrenByPath({});
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
      const cached = categoryCacheRef.current[nextCategory.key];
      delete categoryCacheRef.current[nextCategory.key];
      resetChildDirectoryCacheVersion(nextCategory.key);

      setActiveCategoryKey(nextCategory.key);
      setSearchValue('');
      setIsSearching(false);
      setSearchItems([]);
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
    [
      activeSessionId,
      expandCurrentSessionDirectory,
      fetchList,
      fileCategories,
      intl,
      resetChildDirectoryCacheVersion,
      resourceId,
    ]
  );

  // 回答完成后刷新一次文件列表（含已展开目录），避免流式过程中频繁刷新
  useEffect(() => {
    let refreshTimer: number | null = null;

    const scheduleRefresh = (payload?: any) => {
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
      }
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void refreshExpandedDirectories(payload);
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
  }, [EventEmitter, activeSessionId, refreshExpandedDirectories]);

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
      setSearchValue(nextKeyword);
      if (!nextKeyword) {
        searchRequestSeqRef.current += 1;
        setIsSearching(false);
        setSearchItems([]);
        setChildrenByPath({});
        await fetchList(currentPath, { force: true });
        return;
      }
      const requestSeq = ++searchRequestSeqRef.current;
      fetchListRequestSeqRef.current += 1;
      setIsSearching(true);
      setChildrenByPath({});
      setLoading(true);
      try {
        const visitedDirectories = new Set<string>();
        const resultMap = new Map<string, FileBrowserItem>();

        const collectSearchResults = async (path: string) => {
          const normalizedPath = ensureDirectoryPath(normalizeFileBrowserPath(path || ROOT_FILE_PATH));
          if (visitedDirectories.has(normalizedPath)) {
            return;
          }
          visitedDirectories.add(normalizedPath);

          const res: any = await searchFiles({ resourceId, path: normalizedPath, keyword: nextKeyword });
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
        if (requestSeq === searchRequestSeqRef.current) {
          setSearchItems(Array.from(resultMap.values()));
        }
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.error.loadFailed' }));
      } finally {
        if (requestSeq === searchRequestSeqRef.current) {
          setLoading(false);
        }
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
    refreshExpandedDirectories,
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
      formData.append('processFrontMatter', String(processFrontMatter));
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
      markChildDirectoriesFresh,
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
        resetChildDirectoryCacheVersion('shared');
      }
      if (normalizedPath === ensureDirectoryPath(currentPath)) {
        setSearchValue('');
        setIsSearching(false);
        // 重新拉取根级与所有已展开目录，避免清空已展开目录的子级数据
        await refreshExpandedDirectories();
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
      refreshExpandedDirectories,
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
        resetChildDirectoryCacheVersion(category.key);
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
    [activeSessionId, expandCurrentSessionDirectory, fetchList, intl, resetChildDirectoryCacheVersion, resourceId]
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
      const categoryPath = ensureDirectoryPath(path || getCategoryActivePath(category, activeSessionId));
      try {
        if (category.key !== 'root') {
          await ensureFolder({ resourceId, path: categoryPath });
        }
        setLoading(true);
        delete categoryCacheRef.current[category.key];
        resetChildDirectoryCacheVersion(category.key);
        setActiveCategoryKey(category.key);
        activeCategoryKeyRef.current = category.key;
        currentPathRef.current = categoryPath;
        setCurrentPath(categoryPath);
        setSearchValue('');
        setIsSearching(false);
        setSearchItems([]);
        setItems([]);
        setChildrenByPath({});
        const expandedPathChain = buildDirectoryPathChain(categoryPath);
        const defaultExpandedKeys =
          category.key === 'session' && activeSessionId ? [getSessionFilePath(activeSessionId)] : [];
        setExpandedTreeKeys(Array.from(new Set([...defaultExpandedKeys, ...expandedPathChain])));
        const categoryRootPath = getCategoryRootPath(category.key);
        const parentPaths = expandedPathChain
          .filter((item) => item !== categoryPath)
          .filter((item) => category.key === 'root' || isPathIn(item, categoryRootPath));
        const [targetResponse, ...parentResponses] = await Promise.all([
          listFiles({ resourceId, path: categoryPath }),
          ...parentPaths.map((item) => listFiles({ resourceId, path: item })),
        ]);
        const nextItems = unwrapListResponse<FileBrowserItem>(targetResponse);
        const nextChildrenByPath = parentPaths.reduce<Record<string, FileBrowserItem[]>>((acc, item, index) => {
          acc[item] = unwrapListResponse<FileBrowserItem>(parentResponses[index]);
          return acc;
        }, {});
        markChildDirectoriesFresh(category.key, parentPaths);
        updateCategoryCache(category.key, {
          path: categoryPath,
          items: nextItems,
          childrenByPath: nextChildrenByPath,
        });
        setItems(nextItems);
        setChildrenByPath(nextChildrenByPath);
        if (category.key === 'session' && categoryPath === SESSION_FILE_PATH) {
          await expandCurrentSessionDirectory(activeSessionId);
        }
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.error.loadFailed' }));
      } finally {
        setLoading(false);
      }
    },
    [
      activeSessionId,
      expandCurrentSessionDirectory,
      intl,
      markChildDirectoriesFresh,
      resetChildDirectoryCacheVersion,
      resourceId,
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
      const siblingRes = await listFiles({ resourceId, path: parentPath });
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

  const loadTreeNode = useCallback(
    async (node: FileTreeItem) => {
      if (!isDirectory(node)) return;
      const path = ensureDirectoryPath(node.path);
      const activeRootPath = getCategoryRootPath(activeCategoryKey);
      if (activeCategoryKey !== 'root' && !isPathIn(path, activeRootPath)) return;
      if (childrenByPath[path] && !isChildDirectoryCacheStale(activeCategoryKey, path)) return;
      try {
        const res: any = await listFiles({ resourceId, path });
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
        message.error(error?.message || intl.formatMessage({ id: 'fileBrowser.error.loadFailed' }));
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

  return (
    <div className={styles.miniList}>
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
