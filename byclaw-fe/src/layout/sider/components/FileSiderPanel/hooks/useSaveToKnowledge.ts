import { useCallback, useState } from 'react';
import { message } from 'antd';
import { useIntl } from '@umijs/max';
import type { UploadConfirmFile } from '@/components/UploadConfirmModal';
import type { IKnowledgeBaseItem } from '@/layout/sider/components/Knowledge/components/KnowledgeBase/types';
import { queryDigEmployeeManageKnowledgeResourceAuth } from '@/pages/manager/service/resources';
import {
  checkUploadFileConflicts,
  queryDirAndFileByLevel,
  type QueryDirAndFileByLevelItem,
} from '@/service/knowledgeCenter';
import { listFiles, saveToKnowledge as saveFileBrowserToKnowledge, type FileBrowserItem } from '@/service/fileBrowser';
import { ensureDirectoryPath, isDirectory, joinKnowledgeDirectoryPath, unwrapListResponse } from '../utils';

interface PendingKnowledgeUpload extends UploadConfirmFile {
  source: FileBrowserItem;
  targetDirectoryPath: string;
}

interface UseSaveToKnowledgeOptions {
  resourceId: string;
  clearClickTimer: () => void;
}

const getErrorMessage = (error: any, fallback: string) => {
  if (typeof error === 'string' && error.trim()) {
    return error;
  }
  return error?.message || error?.msg || fallback;
};

const isKnowledgeDirectoryNotFoundError = (error: any) =>
  getErrorMessage(error, '').toLowerCase().includes('directory not found') ||
  getErrorMessage(error, '').includes('目录不存在');

export default function useSaveToKnowledge({ resourceId, clearClickTimer }: UseSaveToKnowledgeOptions) {
  const intl = useIntl();
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
  const [knowledgeUploadConfirmOpen, setKnowledgeUploadConfirmOpen] = useState(false);
  const [pendingKnowledgeUploads, setPendingKnowledgeUploads] = useState<PendingKnowledgeUpload[]>([]);
  const [pendingKnowledgeConflicts, setPendingKnowledgeConflicts] = useState<string[]>([]);
  const [pendingKnowledgeDirectoryPath, setPendingKnowledgeDirectoryPath] = useState('/');
  const [pendingKnowledgeBase, setPendingKnowledgeBase] = useState<IKnowledgeBaseItem | null>(null);

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
        message.error(getErrorMessage(error, intl.formatMessage({ id: 'fileBrowser.error.loadFailed' })));
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
        message.error(getErrorMessage(error, intl.formatMessage({ id: 'fileBrowser.error.loadFailed' })));
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
        message.error(getErrorMessage(error, intl.formatMessage({ id: 'fileBrowser.error.loadFailed' })));
        return [];
      }
    },
    [intl]
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

  const handleSelectKnowledgeBase = useCallback(
    (kb: IKnowledgeBaseItem) => {
      setSelectedKnowledgeBase(kb);
      void loadKnowledgeFolders(kb, '/');
    },
    [loadKnowledgeFolders]
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
        try {
          const response = await checkUploadFileConflicts(
            {
              resourceId: kb.resourceId,
              directoryPath,
              fileNames,
            },
            {
              responseCfg: {
                hideErrorTips: true,
              },
            }
          );
          conflicts.push(...(response?.overwritePaths || []));
        } catch (error: any) {
          if (isKnowledgeDirectoryNotFoundError(error)) {
            continue;
          }
          throw error;
        }
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
      message.error(getErrorMessage(error, intl.formatMessage({ id: 'fileSider.saveToKnowledge.failed' })));
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

  const handleConfirmKnowledgeUpload = useCallback(
    async (processFrontMatter: boolean) => {
      if (!saveTarget || !pendingKnowledgeBase) return;
      const overwrite = pendingKnowledgeConflicts.length > 0;
      setSavingToKnowledge(true);
      try {
        await saveFileBrowserToKnowledge({
          resourceId,
          sourcePath: saveTarget.path,
          sourceDir: isDirectory(saveTarget),
          targetResourceId: pendingKnowledgeBase.resourceId,
          targetDirectoryPath: pendingKnowledgeDirectoryPath,
          processFrontMatter,
          overwrite,
        });
        message.success(intl.formatMessage({ id: 'multiChoices.saveToKnowledge.success' }));
        setKnowledgeUploadConfirmOpen(false);
        setPendingKnowledgeUploads([]);
        setPendingKnowledgeConflicts([]);
        setPendingKnowledgeBase(null);
        setPendingKnowledgeDirectoryPath('/');
        setSaveModalOpen(false);
        setSaveTarget(null);
      } catch (error: any) {
        message.error(getErrorMessage(error, intl.formatMessage({ id: 'fileSider.saveToKnowledge.failed' })));
      } finally {
        setSavingToKnowledge(false);
      }
    },
    [
      intl,
      pendingKnowledgeBase,
      pendingKnowledgeConflicts.length,
      pendingKnowledgeDirectoryPath,
      resourceId,
      saveTarget,
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

  const handleCancelSaveToKnowledge = useCallback(() => {
    if (savingToKnowledge) return;
    setSaveModalOpen(false);
    setSaveTarget(null);
  }, [savingToKnowledge]);

  return {
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
  };
}
