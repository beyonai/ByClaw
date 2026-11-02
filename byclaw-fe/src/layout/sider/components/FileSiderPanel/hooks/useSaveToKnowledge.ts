import { useCallback, useRef, useState } from 'react';
import { message } from 'antd';
import { useIntl } from '@umijs/max';
import { localizeErrorMessage } from '@/utils/localizeErrorMessage';
import { getMimeType } from '@/components/QueryInput/components/FileBrowserEntry/components/FileBrowserPanel/constants';
import type { UploadConfirmFile } from '@/components/UploadConfirmModal';
import type { IKnowledgeBaseItem } from '@/layout/sider/components/Knowledge/components/KnowledgeBase/types';
import { listResourceUseAuth, queryDigEmployeeManageKnowledgeResourceAuth } from '@/pages/manager/service/resources';
import {
  buildDataset,
  checkUploadFileConflicts,
  createFolder as createKnowledgeFolder,
  queryDirAndFileByLevel,
  uploadFiles as uploadKnowledgeFiles,
  type QueryDirAndFileByLevelItem,
} from '@/service/knowledgeCenter';
import {
  downloadFile,
  listFiles,
  saveToPersonalKnowledge,
  type FileBrowserItem,
  type FileBrowserKnowledgeSaveResult,
} from '@/service/fileBrowser';
import { ensureDirectoryPath, getRawBlob, isDirectory, joinKnowledgeDirectoryPath, unwrapListResponse } from '../utils';

interface PendingKnowledgeUpload extends UploadConfirmFile {
  source: FileBrowserItem;
  targetDirectoryPath: string;
}

interface UseSaveToKnowledgeOptions {
  resourceId: string;
  personalOnly?: boolean;
  clearClickTimer: () => void;
}

export default function useSaveToKnowledge({
  resourceId,
  clearClickTimer,
  personalOnly = false,
}: UseSaveToKnowledgeOptions) {
  const intl = useIntl();
  const knowledgeRequestRef = useRef(0);
  const submitRef = useRef(false);
  const folderRequestRef = useRef(0);
  const [saveResult, setSaveResult] = useState<FileBrowserKnowledgeSaveResult | null>(null);
  const [saveResultBuildRequested, setSaveResultBuildRequested] = useState(true);
  const [pendingBuildAfterSave, setPendingBuildAfterSave] = useState(true);
  const [retryingBuild, setRetryingBuild] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveTarget, setSaveTarget] = useState<FileBrowserItem | null>(null);
  const [knowledgeKeyword, setKnowledgeKeyword] = useState('');
  const [knowledgeBases, setKnowledgeBases] = useState<IKnowledgeBaseItem[]>([]);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [selectedKnowledgeBase, setSelectedKnowledgeBase] = useState<IKnowledgeBaseItem | null>(null);
  const [knowledgeDirectoryPath, setKnowledgeDirectoryPath] = useState('/');
  const [knowledgeFolders, setKnowledgeFolders] = useState<QueryDirAndFileByLevelItem[]>([]);
  const [knowledgeFolderLoading, setKnowledgeFolderLoading] = useState(false);
  const [knowledgeFolderReady, setKnowledgeFolderReady] = useState(false);
  const [savingToKnowledge, setSavingToKnowledge] = useState(false);
  const [knowledgeUploadConfirmOpen, setKnowledgeUploadConfirmOpen] = useState(false);
  const [pendingKnowledgeUploads, setPendingKnowledgeUploads] = useState<PendingKnowledgeUpload[]>([]);
  const [pendingKnowledgeConflicts, setPendingKnowledgeConflicts] = useState<string[]>([]);
  const [pendingKnowledgeDirectoryPath, setPendingKnowledgeDirectoryPath] = useState('/');
  const [pendingKnowledgeBase, setPendingKnowledgeBase] = useState<IKnowledgeBaseItem | null>(null);

  const loadKnowledgeBases = useCallback(
    async (keyword = knowledgeKeyword) => {
      const requestId = ++knowledgeRequestRef.current;
      setKnowledgeLoading(true);
      setKnowledgeBases([]);
      try {
        const rows: IKnowledgeBaseItem[] = [];
        let pageNum = 1;
        while (true) {
          let response;
          if (personalOnly) {
            response = await listResourceUseAuth({
              ownerType: 'personal',
              permission: 'MANAGEABLE_BY_ME',
              resourceBizTypeList: ['KG_DOC', 'KG_QA', 'KG_TERM'],
              resourceStatus: '',
              excludeDeleted: true,
              pageNum,
              pageSize: 100,
              keyword: keyword.trim(),
            });
          } else {
            response = await queryDigEmployeeManageKnowledgeResourceAuth({
              resourceId,
              pageNum,
              pageSize: 30,
              keyword: keyword.trim(),
            });
          }
          if (requestId !== knowledgeRequestRef.current) return;
          const data = response?.data || response;
          const page = Array.isArray(data?.rows) ? data.rows : Array.isArray(data?.list) ? data.list : [];
          rows.push(
            ...page.filter(
              (item: IKnowledgeBaseItem & { hasManagePermission?: boolean }) =>
                !personalOnly ||
                (['personal', 'personal_default'].includes(item.ownerType || '') && item.hasManagePermission === true)
            )
          );
          // 个人知识库需覆盖所有分页，不能只显示前 30 个；旧员工入口保持原行为。
          if (
            !personalOnly ||
            !page.length ||
            (pageNum >= Number(data?.totalPages || 0) && pageNum * 100 >= Number(data?.total || 0))
          )
            break;
          pageNum += 1;
        }
        setKnowledgeBases(rows);
      } catch (error: any) {
        if (requestId === knowledgeRequestRef.current) {
          message.error(
            localizeErrorMessage(
              error?.message,
              intl.formatMessage({ id: 'fileBrowser.error.loadFailed' }),
              intl.locale
            )
          );
        }
      } finally {
        if (requestId === knowledgeRequestRef.current) setKnowledgeLoading(false);
      }
    },
    [intl, knowledgeKeyword, personalOnly, resourceId]
  );

  const loadKnowledgeFolders = useCallback(
    async (kb: IKnowledgeBaseItem, directoryPath: string) => {
      const requestId = ++folderRequestRef.current;
      setKnowledgeFolderLoading(true);
      setKnowledgeFolderReady(false);
      try {
        const response = await queryDirAndFileByLevel({
          resourceId: Number(kb.resourceId),
          directoryPath,
        });
        const folders = unwrapListResponse<QueryDirAndFileByLevelItem>(response).filter(
          (item) => item.type === 'directory'
        );
        if (requestId !== folderRequestRef.current) return [];
        setKnowledgeFolders(folders);
        setKnowledgeDirectoryPath(directoryPath);
        setKnowledgeFolderReady(true);
        return folders;
      } catch (error: any) {
        message.error(
          localizeErrorMessage(error?.message, intl.formatMessage({ id: 'fileBrowser.error.loadFailed' }), intl.locale)
        );
        return [];
      } finally {
        if (requestId === folderRequestRef.current) setKnowledgeFolderLoading(false);
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
        message.error(
          localizeErrorMessage(error?.message, intl.formatMessage({ id: 'fileBrowser.error.loadFailed' }), intl.locale)
        );
        return [];
      }
    },
    [intl]
  );

  const openSaveToKnowledge = useCallback(
    (item: FileBrowserItem) => {
      if (submitRef.current) return;
      clearClickTimer();
      folderRequestRef.current += 1;
      setKnowledgeFolderLoading(false);
      setKnowledgeFolderReady(false);
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
      setKnowledgeDirectoryPath('/');
      setKnowledgeFolders([]);
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

  const handleConfirmSaveToKnowledge = useCallback(
    async (buildAfterSave = true) => {
      if (!saveTarget || submitRef.current || knowledgeFolderLoading || (personalOnly && !knowledgeFolderReady)) return;
      if (!selectedKnowledgeBase) {
        message.warning(intl.formatMessage({ id: 'multiChoices.saveToKnowledge.selectKb' }));
        return;
      }

      submitRef.current = true;
      setSavingToKnowledge(true);
      setPendingBuildAfterSave(buildAfterSave);
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
        message.error(
          localizeErrorMessage(
            typeof error === 'string' ? error : error?.message,
            intl.formatMessage({ id: 'fileSider.saveToKnowledge.failed' }),
            intl.locale
          )
        );
      } finally {
        submitRef.current = false;
        setSavingToKnowledge(false);
      }
    },
    [
      personalOnly,
      knowledgeFolderReady,
      knowledgeFolderLoading,
      checkKnowledgeUploadConflicts,
      collectKnowledgeUploads,
      intl,
      knowledgeDirectoryPath,
      saveTarget,
      selectedKnowledgeBase,
    ]
  );

  const handleConfirmKnowledgeUpload = useCallback(
    async (processFrontMatter: boolean) => {
      if (!saveTarget || !pendingKnowledgeBase || submitRef.current) return;
      submitRef.current = true;
      const overwrite = pendingKnowledgeConflicts.length > 0;
      setSavingToKnowledge(true);
      try {
        if (personalOnly) {
          const result = await saveToPersonalKnowledge({
            resourceId,
            sourcePath: saveTarget.path,
            sourceDir: isDirectory(saveTarget),
            targetResourceId: pendingKnowledgeBase.resourceId,
            targetDirectoryPath: pendingKnowledgeDirectoryPath,
            buildAfterSave: pendingBuildAfterSave,
            processFrontMatter,
            overwrite,
          });
          setSaveResult(result);
          setSaveResultBuildRequested(pendingBuildAfterSave);
        } else if (isDirectory(saveTarget)) {
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
        if (!personalOnly) message.success(intl.formatMessage({ id: 'multiChoices.saveToKnowledge.success' }));
        setKnowledgeUploadConfirmOpen(false);
        setPendingKnowledgeUploads([]);
        setPendingKnowledgeConflicts([]);
        setPendingKnowledgeBase(null);
        setPendingKnowledgeDirectoryPath('/');
        setSaveModalOpen(false);
        setSaveTarget(null);
      } catch (error: any) {
        message.error(
          localizeErrorMessage(
            typeof error === 'string' ? error : error?.message,
            intl.formatMessage({ id: 'fileSider.saveToKnowledge.failed' }),
            intl.locale
          )
        );
      } finally {
        submitRef.current = false;
        setSavingToKnowledge(false);
      }
    },
    [
      personalOnly,
      resourceId,
      copyFileBrowserDirectoryToKnowledge,
      intl,
      pendingKnowledgeBase,
      pendingBuildAfterSave,
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

  const retryFailedBuilds = useCallback(async () => {
    if (!saveResult || submitRef.current) return;
    submitRef.current = true;
    setRetryingBuild(true);
    const failures = [];
    let submitted = 0;
    try {
      for (const item of saveResult.buildFailedItems) {
        if (!item.filePath) {
          failures.push(item);
          continue;
        }
        try {
          await buildDataset({ resourceId: String(saveResult.targetResourceId), directoryPath: item.filePath });
          submitted += 1;
        } catch (error: any) {
          failures.push({ ...item, error: error?.msg || error?.message || String(error) });
        }
      }
      setSaveResult({
        ...saveResult,
        buildSubmittedCount: saveResult.buildSubmittedCount + submitted,
        buildFailedItems: failures,
      });
    } finally {
      submitRef.current = false;
      setRetryingBuild(false);
    }
  }, [saveResult]);

  return {
    saveResult,
    saveResultBuildRequested,
    pendingBuildAfterSave,
    setSaveResult,
    retryingBuild,
    retryFailedBuilds,
    saveModalOpen,
    knowledgeKeyword,
    knowledgeBases,
    knowledgeLoading,
    selectedKnowledgeBase,
    knowledgeDirectoryPath,
    knowledgeFolders,
    knowledgeFolderLoading,
    knowledgeFolderReady,
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
