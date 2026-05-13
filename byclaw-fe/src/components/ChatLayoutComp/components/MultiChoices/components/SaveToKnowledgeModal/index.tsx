import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Tabs, Input, Spin, Empty, message } from 'antd';
import { useIntl, useSelector } from '@umijs/max';
import classnames from 'classnames';
import AntdIcon from '@/components/AntdIcon';

import { listResourceUseAuth } from '@/pages/manager/service/resources';
import { uploadFiles } from '@/service/knowledgeCenter';
import { referenceToOpenClawHandler } from '@/components/ChatLayoutComp/components/MultiChoices/util';

import type { IMessage } from '@/typescript/message';
import styles from './index.module.less';

export type ResourceCatalogMain = 'enterprise' | 'personal';

export interface SaveToKnowledgeModalProps {
  open: boolean;
  onClose: () => void;
  multiChoicesMsgId: string[];
  messageList: IMessage[];
  onSuccess?: () => void;
}

const tabCatalog: { key: ResourceCatalogMain; labelId: string }[] = [
  { key: 'personal', labelId: 'multiChoices.saveToKnowledge.personal' },
  { key: 'enterprise', labelId: 'multiChoices.saveToKnowledge.enterprise' },
];

function SaveToKnowledgeModal(props: SaveToKnowledgeModalProps) {
  const { open, onClose, multiChoicesMsgId, messageList, onSuccess } = props;
  const intl = useIntl();
  const { userInfo } = useSelector((state: any) => state.user);
  const [activeCatalog, setActiveCatalog] = useState<ResourceCatalogMain>('personal');
  const [keyword, setKeyword] = useState('');
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedResourceId, setSelectedResourceId] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [fileName, setFileName] = useState('');
  const [countdown, setCountdown] = useState(15);
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
    setSelectedResourceId(undefined);
    setKeyword('');
    setActiveCatalog('personal');
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    const delay = keyword.trim() ? 300 : 0;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await listResourceUseAuth({
          pageNum: 1,
          pageSize: 100,
          keyword: keyword.trim(),
          ownerType: activeCatalog,
          resourceBizTypeList: ['KG_DOC'],
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
  }, [open, activeCatalog, keyword]);

  const handleConfirmSave = async () => {
    if (!textFile) return;
    if (!selectedResourceId) return;

    const formData = new FormData();
    formData.append('resourceId', String(selectedResourceId));
    formData.append('directoryPath', '/');
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
      { userName, timestamp }
    );

    setFileName(defaultFileName);
    setCountdown(15);
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

  const tabItems = tabCatalog.map((t) => ({
    key: t.key,
    label: intl.formatMessage({ id: t.labelId }),
    children: (
      <div className={styles.modalContent}>
        <Spin spinning={loading}>
          {list.length === 0 && !loading ? (
            <Empty description={intl.formatMessage({ id: 'multiChoices.saveToKnowledge.empty' })} />
          ) : (
            <div className={styles.listContainer}>
              <div className={styles.grid}>
                {list.map((item: any) => {
                  const id = item.resourceId ?? item.id;
                  const name = item.resourceName ?? item.name ?? id;
                  const idStr = String(id);
                  const isSelected = selectedResourceId === idStr;
                  return (
                    <div
                      key={idStr}
                      className={classnames(styles.card, { [styles.cardSelected]: isSelected })}
                      onClick={() => setSelectedResourceId(idStr)}
                    >
                      <div className={styles.cardHeader}>
                        <div className={styles.cardIcon}>
                          <AntdIcon type="icon-chuangjianfangshi-wendangku" className={styles.icon} />
                        </div>
                        <span className={styles.cardTitle} title={String(name)}>
                          {name}
                        </span>
                      </div>
                      {item.resourceDesc && (
                        <span className={styles.cardDesc} title={String(item.resourceDesc)}>
                          {item.resourceDesc}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Spin>
      </div>
    ),
  }));

  return (
    <>
      <Modal
        title={intl.formatMessage({ id: 'multiChoices.saveToKnowledge.title' })}
        open={open}
        zIndex={999}
        onCancel={onClose}
        onOk={handleOk}
        confirmLoading={submitting}
        okButtonProps={{ disabled: !selectedResourceId || submitting }}
        width="60%"
        destroyOnClose
      >
        <Tabs
          activeKey={activeCatalog}
          onChange={(k) => {
            setActiveCatalog(k as ResourceCatalogMain);
            setSelectedResourceId(undefined);
            setKeyword('');
          }}
          tabBarExtraContent={{
            right: (
              <Input.Search
                allowClear
                placeholder={intl.formatMessage({
                  id: 'multiChoices.saveToKnowledge.searchPlaceholder',
                })}
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onSearch={(v) => setKeyword(v)}
                className={styles.searchInput}
              />
            ),
          }}
          items={tabItems}
        />
      </Modal>
      <Modal
        title={intl.formatMessage({ id: 'multiChoices.saveToKnowledge.confirmTitle' })}
        open={confirmModalOpen}
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
              setCountdown(15);
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
