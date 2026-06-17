import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Input, message } from 'antd';
import { useIntl, useSelector } from '@umijs/max';
import KnowledgeTargetSelector from '@/components/KnowledgeTargetSelector';
import { useActiveSiderAgent } from '@/layout/sider/components/ActiveSiderAgentBar';

import { queryDigEmployeeManageKnowledgeResourceAuth } from '@/pages/manager/service/resources';
import { queryDirAndFileByLevel, uploadFiles, type QueryDirAndFileByLevelItem } from '@/service/knowledgeCenter';
import { referenceToOpenClawHandler } from '@/components/ChatLayoutComp/components/MultiChoices/util';

import type { IMessage } from '@/typescript/message';
import styles from './index.module.less';

export interface SaveToKnowledgeModalProps {
  open: boolean;
  onClose: () => void;
  multiChoicesMsgId: string[];
  messageList: IMessage[];
  onSuccess?: () => void;
  agentName?: string;
}

function SaveToKnowledgeModal(props: SaveToKnowledgeModalProps) {
  const { open, onClose, multiChoicesMsgId, messageList, onSuccess, agentName } = props;
  const intl = useIntl();
  const resolvedAgentName = agentName || intl.formatMessage({ id: 'common.digitalEmployee' });
  const { userInfo } = useSelector((state: any) => state.user);
  const activeSiderAgent = useActiveSiderAgent();
  const [keyword, setKeyword] = useState('');
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedKnowledgeBase, setSelectedKnowledgeBase] = useState<any | null>(null);
  const [knowledgeDirectoryPath, setKnowledgeDirectoryPath] = useState('/');
  const [knowledgeFolders, setKnowledgeFolders] = useState<QueryDirAndFileByLevelItem[]>([]);
  const [knowledgeFolderLoading, setKnowledgeFolderLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [fileName, setFileName] = useState('');
  const [countdown, setCountdown] = useState(30);
  const [countdownTimer, setCountdownTimer] = useState<NodeJS.Timeout | null>(null);

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
    setKnowledgeDirectoryPath('/');
    setKnowledgeFolders([]);
    setKeyword('');
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (!activeSiderAgent.resourceId) {
      setList([]);
      return;
    }
    let cancelled = false;
    const delay = keyword.trim() ? 300 : 0;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await queryDigEmployeeManageKnowledgeResourceAuth({
          resourceId: activeSiderAgent.resourceId,
          pageNum: 1,
          pageSize: 30,
          keyword: keyword.trim(),
        });
        if (cancelled) {
          return;
        }
        const rows = Array.isArray(res?.list) ? res.list : Array.isArray(res?.rows) ? res.rows : [];
        setList(rows);
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          setList([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeSiderAgent.resourceId, open, keyword]);

  const selectedResourceId = selectedKnowledgeBase
    ? String(selectedKnowledgeBase.resourceId ?? selectedKnowledgeBase.id ?? '')
    : undefined;

  const loadKnowledgeFolders = async (knowledgeBase: any, directoryPath: string) => {
    const resourceId = knowledgeBase?.resourceId ?? knowledgeBase?.id;
    if (!resourceId) return;
    setKnowledgeFolderLoading(true);
    try {
      const response = await queryDirAndFileByLevel({
        resourceId: Number(resourceId),
        directoryPath,
      });
      let rows: QueryDirAndFileByLevelItem[] = [];
      if (Array.isArray(response)) {
        rows = response;
      } else if (Array.isArray((response as any)?.data)) {
        rows = (response as any).data;
      }
      setKnowledgeFolders(rows.filter((item: QueryDirAndFileByLevelItem) => item.type === 'directory'));
      setKnowledgeDirectoryPath(directoryPath);
    } catch (error) {
      console.error(error);
      setKnowledgeFolders([]);
    } finally {
      setKnowledgeFolderLoading(false);
    }
  };

  const handleSelectKnowledgeBase = (knowledgeBase: any) => {
    setSelectedKnowledgeBase(knowledgeBase);
    void loadKnowledgeFolders(knowledgeBase, '/');
  };

  const handleConfirmSave = async () => {
    if (!textFile) return;
    if (!selectedResourceId) return;
    const formData = new FormData();
    formData.append('resourceId', String(selectedResourceId));
    formData.append('directoryPath', knowledgeDirectoryPath || '/');
    formData.append('files', textFile);

    setSubmitting(true);
    try {
      await uploadFiles(formData);
      message.success(intl.formatMessage({ id: 'multiChoices.saveToKnowledge.success' }));
      onSuccess?.();
      onClose();
      setConfirmModalOpen(false);
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
    if (!selectedResourceId) {
      message.warning(intl.formatMessage({ id: 'multiChoices.saveToKnowledge.selectKb' }));
      return;
    }
    const userName = userInfo?.userName || '';
    // 生成默认文件名
    const now = new Date();
    const timestamp =
      now.getFullYear() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0') +
      '_' +
      String(now.getHours()).padStart(2, '0') +
      String(now.getMinutes()).padStart(2, '0') +
      String(now.getSeconds()).padStart(2, '0');
    const defaultFileName = intl.formatMessage(
      { id: 'multiChoices.saveToKnowledge.defaultFileName' },
      { userName, agentName: resolvedAgentName, timestamp }
    );

    setFileName(defaultFileName);
    setCountdown(30);
    setConfirmModalOpen(true);

    // 启动倒计时
    if (countdownTimer) {
      clearInterval(countdownTimer);
      setCountdownTimer(null);
    }
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setCountdownTimer(null);
          handleConfirmSave();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    setCountdownTimer(timer);
  };

  return (
    <>
      <KnowledgeTargetSelector
        open={open}
        onCancel={onClose}
        onOk={handleOk}
        confirmLoading={submitting}
        okDisabled={!selectedResourceId || submitting}
        width="60%"
        zIndex={999}
        keyword={keyword}
        onKeywordChange={setKeyword}
        onSearch={setKeyword}
        knowledgeBases={list}
        knowledgeLoading={loading}
        selectedKnowledgeBase={selectedKnowledgeBase}
        onSelectKnowledgeBase={handleSelectKnowledgeBase}
        onBackToList={() => {
          setSelectedKnowledgeBase(null);
          setKnowledgeDirectoryPath('/');
          setKnowledgeFolders([]);
        }}
        directoryPath={knowledgeDirectoryPath}
        folders={knowledgeFolders}
        folderLoading={knowledgeFolderLoading}
        onBreadcrumbClick={(directoryPath) => {
          if (selectedKnowledgeBase) {
            void loadKnowledgeFolders(selectedKnowledgeBase, directoryPath);
          }
        }}
        onFolderClick={(_, directoryPath) => {
          if (selectedKnowledgeBase) {
            void loadKnowledgeFolders(selectedKnowledgeBase, directoryPath);
          }
        }}
        emptyText={intl.formatMessage({ id: 'multiChoices.saveToKnowledge.empty' })}
        folderEmptyText={intl.formatMessage({ id: 'fileSider.saveToKnowledge.rootTip' })}
      />
      <Modal
        title={intl.formatMessage({ id: 'multiChoices.saveToKnowledge.confirmTitle' })}
        open={confirmModalOpen}
        width={600}
        zIndex={1000}
        onCancel={() => {
          setConfirmModalOpen(false);
          if (countdownTimer) {
            clearInterval(countdownTimer);
            setCountdownTimer(null);
          }
        }}
        onOk={() => {
          if (countdownTimer) {
            clearInterval(countdownTimer);
            setCountdownTimer(null);
          }
          handleConfirmSave();
        }}
        confirmLoading={submitting}
      >
        <div className={styles.fileNameRow}>
          <p className={styles.fileNameLabel}>
            {intl.formatMessage({ id: 'multiChoices.saveToKnowledge.fileName' })}：
          </p>
          <Input
            value={fileName}
            onChange={(e) => {
              setFileName(e.target.value);
              setCountdown(30);
              if (countdownTimer) {
                clearInterval(countdownTimer);
                setCountdownTimer(null);
              }
              const timer = setInterval(() => {
                setCountdown((prev) => {
                  if (prev <= 1) {
                    clearInterval(timer);
                    setCountdownTimer(null);
                    handleConfirmSave();
                    return 0;
                  }
                  return prev - 1;
                });
              }, 1000);
              setCountdownTimer(timer);
            }}
            suffix=".md"
          />
        </div>
        <p className={styles.countdownText}>
          {intl.formatMessage({ id: 'multiChoices.saveToKnowledge.autoSaveCountdown' }, { countdown })}
        </p>
      </Modal>
    </>
  );
}

export default SaveToKnowledgeModal;
