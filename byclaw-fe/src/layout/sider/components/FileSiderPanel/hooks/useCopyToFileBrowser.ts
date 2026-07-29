import { useCallback, useMemo, useState, type Key } from 'react';
import { message } from 'antd';
import { useIntl } from '@umijs/max';
import { copyFile, ensureFolder, listFiles, type FileBrowserItem } from '@/service/fileBrowser';
import type { FileCategoryKey, FileCopyTargetType } from '../constants';
import { SESSION_FILE_PATH, SHARED_FILE_PATH } from '../constants';
import {
  buildScopedFolderPath,
  ensureDirectoryPath,
  getCopyTargetPath,
  getSessionFilePath,
  isDirectory,
  isPathIn,
  normalizeFileBrowserPath,
  unwrapListResponse,
} from '../utils';

interface UseCopyToFileBrowserOptions {
  resourceId: string;
  activeSessionId: string;
  expandedTreeKeys: Key[];
  getActiveCategoryKey: () => FileCategoryKey | undefined;
  refreshExpandedDirectories: (payload?: { sessionId?: string }) => Promise<void>;
  clearClickTimer: () => void;
}

export default function useCopyToFileBrowser({
  resourceId,
  activeSessionId,
  expandedTreeKeys,
  getActiveCategoryKey,
  refreshExpandedDirectories,
  clearClickTimer,
}: UseCopyToFileBrowserOptions) {
  const intl = useIntl();
  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const [copyTarget, setCopyTarget] = useState<FileBrowserItem | null>(null);
  const [copyTargetType, setCopyTargetType] = useState<FileCopyTargetType>('session');
  const [copyDirectoryPath, setCopyDirectoryPath] = useState('/');
  const [copyFolders, setCopyFolders] = useState<FileBrowserItem[]>([]);
  const [copyFolderLoading, setCopyFolderLoading] = useState(false);
  const [copyingToFileBrowser, setCopyingToFileBrowser] = useState(false);

  const copyFolderPath = useMemo(() => {
    const rootPath = copyTargetType === 'session' ? SESSION_FILE_PATH : SHARED_FILE_PATH;
    return buildScopedFolderPath(copyDirectoryPath, rootPath);
  }, [copyDirectoryPath, copyTargetType]);

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
        getActiveCategoryKey() === 'session' &&
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
    getActiveCategoryKey,
    intl,
    refreshExpandedDirectories,
    resourceId,
  ]);

  const handleCancelCopyToFileBrowser = useCallback(() => {
    if (copyingToFileBrowser) return;
    setCopyModalOpen(false);
    setCopyTarget(null);
  }, [copyingToFileBrowser]);

  return {
    copyModalOpen,
    copyTargetType,
    copyTargetName: copyTarget?.name,
    copyDirectoryPath,
    copyFolderPath,
    copyFolders,
    copyFolderLoading,
    copyingToFileBrowser,
    loadCopyFolders,
    openCopyToFileBrowser,
    handleConfirmCopyToFileBrowser,
    handleCancelCopyToFileBrowser,
  };
}
