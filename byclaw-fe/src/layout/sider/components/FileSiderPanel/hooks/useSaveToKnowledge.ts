import { useCallback, useState } from 'react';
import { message } from 'antd';
import { useIntl } from '@umijs/max';
import { getMimeType } from '@/components/QueryInput/components/FileBrowserEntry/components/FileBrowserPanel/constants';
import type { UploadConfirmFile } from '@/components/UploadConfirmModal';
import type { IKnowledgeBaseItem } from '@/layout/sider/components/Knowledge/components/KnowledgeBase/types';
import { queryDigEmployeeManageKnowledgeResourceAuth } from '@/pages/manager/service/resources';
import {
  checkUploadFileConflicts,
  createFolder as createKnowledgeFolder,
  queryDirAndFileByLevel,
  uploadFiles as uploadKnowledgeFiles,
  type QueryDirAndFileByLevelItem,
} from '@/service/knowledgeCenter';
import { downloadFile, listFiles, type FileBrowserItem } from '@/service/fileBrowser';
import { ensureDirectoryPath, getRawBlob, isDirectory, joinKnowledgeDirectoryPath, unwrapListResponse } from '../utils';

interface PendingKnowledgeUpload extends UploadConfirmFile {
  source: FileBrowserItem;
  targetDirectoryPath: string;
}

interface UseSaveToKnowledgeOptions {
  resourceId: string;
  clearClickTimer: () => void;
}

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
      formData.append('processFrontMatter', String(Boolean(options.processFrontMatter)));
      formData.append('overwrite', String(Boolean(options.overwrite)));
      const result = await uploadKnowledgeFiles(formData);
      if (Number(result?.summary?.failed || 0) > 0) {
        throw new Error(result?.failedItems?.[0]?.error || intl.formatMessage({ id: 'fileBrowser.upload.failed' }));
      }
      if (result?.postProcessErrors?.length) {
        message.warning(
          intl.formatMessage(
            { id: 'knowledgeDetail.uploadPostProcessWarning' },
            { count: result.postProcessErrors.length }
          )
        );
      }
    },
    [intl, resourceId]
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
