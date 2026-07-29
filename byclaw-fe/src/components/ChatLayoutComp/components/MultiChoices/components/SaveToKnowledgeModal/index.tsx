import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Input, message } from 'antd';
import { useIntl, useSelector } from '@umijs/max';

import KnowledgeTargetSelector from '@/components/KnowledgeTargetSelector';
import { queryDigEmployeeManageKnowledgeResourceAuth } from '@/pages/manager/service/resources';
import { queryDirAndFileByLevel, uploadFiles, type QueryDirAndFileByLevelItem } from '@/service/knowledgeCenter';
import { referenceToOpenClawHandler } from '@/components/ChatLayoutComp/components/MultiChoices/util';
import type { IKnowledgeBaseItem } from '@/layout/sider/components/Knowledge/components/KnowledgeBase/types';

import type { IMessage } from '@/typescript/message';
import styles from './index.module.less';

export interface SaveToKnowledgeModalProps {
  open: boolean;
  onClose: () => void;
  multiChoicesMsgId: string[];
  messageList: IMessage[];
  onSuccess?: () => void;
  agentName?: string;
  resourceId?: string | number;
}

function SaveToKnowledgeModal(props: SaveToKnowledgeModalProps) {
  const { open, onClose, multiChoicesMsgId, messageList, onSuccess, agentName, resourceId } = props;
  const intl = useIntl();
  const resolvedAgentName = agentName || intl.formatMessage({ id: 'common.digitalEmployee' });
  const { userInfo } = useSelector((state: any) => state.user);
  const [keyword, setKeyword] = useState('');
  const [knowledgeBases, setKnowledgeBases] = useState<IKnowledgeBaseItem[]>([]);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [selectedKnowledgeBase, setSelectedKnowledgeBase] = useState<IKnowledgeBaseItem | null>(null);
  const [directoryPath, setDirectoryPath] = useState('/');
  const [folders, setFolders] = useState<QueryDirAndFileByLevelItem[]>([]);
  const [folderLoading, setFolderLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fileName, setFileName] = useState('');

  const getDefaultFileName = useCallback(() => {
    const userName = userInfo?.userName || '';
    const now = new Date();
    const timestamp =
      now.getFullYear() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0') +
      '_' +
      String(now.getHours()).padStart(2, '0') +
      String(now.getMinutes()).padStart(2, '0') +
      String(now.getSeconds()).padStart(2, '0');
    return intl.formatMessage(
      { id: 'multiChoices.saveToKnowledge.defaultFileName' },
      { userName, agentName: resolvedAgentName, timestamp }
    );
  }, [intl, resolvedAgentName, userInfo?.userName]);

  const loadKnowledgeBases = useCallback(
    async (nextKeyword = '') => {
      if (!resourceId) {
        setKnowledgeBases([]);
        return;
      }
      setKnowledgeLoading(true);
      try {
        const res = await queryDigEmployeeManageKnowledgeResourceAuth({
          resourceId,
          pageNum: 1,
          pageSize: 30,
          keyword: nextKeyword.trim(),
        });
        const rows = Array.isArray(res?.rows) ? res.rows : Array.isArray(res?.list) ? res.list : [];
        setKnowledgeBases(rows);
        if (!rows.length) {
          message.warning(intl.formatMessage({ id: 'fileSider.saveToKnowledge.noManagePermission' }));
        }
      } catch (e: any) {
        message.error(e?.message || intl.formatMessage({ id: 'fileBrowser.error.loadFailed' }));
      } finally {
        setKnowledgeLoading(false);
      }
    },
    [intl, resourceId]
  );

  const loadKnowledgeFolders = useCallback(
    async (kb: IKnowledgeBaseItem, nextDirectoryPath: string) => {
      setFolderLoading(true);
      try {
        const res = await queryDirAndFileByLevel({
          resourceId: Number(kb.resourceId),
          directoryPath: nextDirectoryPath,
        });
        const data = res ?? [];
        const nextFolders = Array.isArray(data)
          ? data.filter((item: QueryDirAndFileByLevelItem) => item.type === 'directory')
          : [];
        setFolders(nextFolders);
        setDirectoryPath(nextDirectoryPath);
        return nextFolders;
      } catch (e: any) {
        message.error(e?.message || intl.formatMessage({ id: 'fileBrowser.error.loadFailed' }));
        return [];
      } finally {
        setFolderLoading(false);
      }
    },
    [intl]
  );

  const loadKnowledgeFolderChildren = useCallback(
    async (kb: IKnowledgeBaseItem, nextDirectoryPath: string) => {
      try {
        const res = await queryDirAndFileByLevel({
          resourceId: Number(kb.resourceId),
          directoryPath: nextDirectoryPath,
        });
        const data = res ?? [];
        return Array.isArray(data) ? data.filter((item: QueryDirAndFileByLevelItem) => item.type === 'directory') : [];
      } catch (e: any) {
        message.error(e?.message || intl.formatMessage({ id: 'fileBrowser.error.loadFailed' }));
        return [];
      }
    },
    [intl]
  );

  const handleSelectKnowledgeBase = useCallback(
    (kb: IKnowledgeBaseItem) => {
      setSelectedKnowledgeBase(kb);
      setDirectoryPath('/');
      setFolders([]);
      void loadKnowledgeFolders(kb, '/');
    },
    [loadKnowledgeFolders]
  );

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const textFile = useMemo(() => {
    if (!multiChoicesMsgId.length) {
      return null;
    }
    try {
      const resolvedFileName = fileName.trim() ? `${fileName.trim()}.md` : undefined;
      return referenceToOpenClawHandler(messageList, multiChoicesMsgId, resolvedFileName);
    } catch {
      return null;
    }
  }, [fileName, messageList, multiChoicesMsgId]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setSelectedKnowledgeBase(null);
    setKeyword('');
    setDirectoryPath('/');
    setFolders([]);
    setFileName(getDefaultFileName());
    void loadKnowledgeBases('');
  }, [getDefaultFileName, loadKnowledgeBases, open]);

  const handleConfirmSave = async () => {
    if (!textFile) return;
    if (!selectedKnowledgeBase) return;

    const formData = new FormData();
    formData.append('resourceId', String(selectedKnowledgeBase.resourceId));
    formData.append('directoryPath', directoryPath);
    formData.append('files', textFile);

    setSubmitting(true);
    try {
      await uploadFiles(formData);
      message.success(intl.formatMessage({ id: 'multiChoices.saveToKnowledge.success' }));
      onSuccess?.();
      handleClose();
    } catch {
      // 失败时 request 层已弹错
    } finally {
      setSubmitting(false);
    }
  };

  const handleOk = () => {
    if (!textFile) {
      message.error(intl.formatMessage({ id: 'multiChoices.saveToKnowledge.noContent' }));
      return;
    }
    if (!selectedKnowledgeBase) {
      message.warning(intl.formatMessage({ id: 'multiChoices.saveToKnowledge.selectKb' }));
      return;
    }
    handleConfirmSave();
  };

  return (
    <KnowledgeTargetSelector
      open={open}
      onOk={handleOk}
      onCancel={handleClose}
      confirmLoading={submitting}
      okDisabled={!selectedKnowledgeBase || submitting}
      keyword={keyword}
      onKeywordChange={setKeyword}
      onSearch={(nextKeyword) => loadKnowledgeBases(nextKeyword)}
      knowledgeBases={knowledgeBases}
      knowledgeLoading={knowledgeLoading}
      selectedKnowledgeBase={selectedKnowledgeBase}
      onSelectKnowledgeBase={(kb) => handleSelectKnowledgeBase(kb as IKnowledgeBaseItem)}
      directoryPath={directoryPath}
      folders={folders}
      folderLoading={folderLoading}
      onFolderClick={(_, nextDirectoryPath) => {
        if (selectedKnowledgeBase) {
          void loadKnowledgeFolders(selectedKnowledgeBase, nextDirectoryPath);
        }
      }}
      onLoadFolderChildren={(nextDirectoryPath) => {
        if (selectedKnowledgeBase) {
          return loadKnowledgeFolderChildren(selectedKnowledgeBase, nextDirectoryPath);
        }
        return Promise.resolve([]);
      }}
      emptyText={intl.formatMessage({ id: 'multiChoices.saveToKnowledge.empty' })}
      folderEmptyText={intl.formatMessage({ id: 'fileSider.saveToKnowledge.rootTip' })}
      footerExtra={
        <div className={styles.fileNameRow}>
          <p className={styles.fileNameLabel}>
            {intl.formatMessage({ id: 'multiChoices.saveToKnowledge.fileName' })}：
          </p>
          <Input value={fileName} onChange={(e) => setFileName(e.target.value)} suffix=".md" />
        </div>
      }
      zIndex={999}
    />
  );
}

export default SaveToKnowledgeModal;
