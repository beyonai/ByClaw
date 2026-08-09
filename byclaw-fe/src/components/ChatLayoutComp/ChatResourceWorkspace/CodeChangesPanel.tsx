import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Empty, List, Spin, Tag } from 'antd';
import { FileTextOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import { getTaskChanges, getTaskFileDiff, type DevloopTaskChanges, type DevloopTaskFileDiff } from '@/service/devloop';
import type { DetailPanelOptions } from '@/layout/sider/siderContentContext';
import styles from './index.module.less';
import { useInfiniteScroll } from '@/pages/projectSpace/hooks/useInfiniteScroll';

interface CodeDiffPanelProps {
  sessionId: string;
  filePath: string;
}

const CodeDiffPanel: React.FC<CodeDiffPanelProps> = ({ sessionId, filePath }) => {
  const [data, setData] = useState<DevloopTaskFileDiff | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void getTaskFileDiff(Number(sessionId), filePath)
      .then((response) => {
        if (active) setData(response || null);
      })
      .catch((error) => {
        console.error('Failed to load conversation file diff:', error);
        if (active) setData(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [filePath, sessionId]);

  return (
    <Spin spinning={loading} wrapperClassName={styles.detailSpin}>
      {data?.diff ? (
        <pre className={styles.diffContent}>
          {data.diff.split('\n').map((line, index) => (
            <span
              key={`${index}-${line}`}
              className={line.startsWith('+') ? styles.diffAdded : line.startsWith('-') ? styles.diffRemoved : ''}
            >
              {line || ' '}
              {'\n'}
            </span>
          ))}
        </pre>
      ) : (
        !loading && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={data?.message} />
      )}
    </Spin>
  );
};

interface CodeChangesPanelProps {
  sessionId: string;
  onOpenDetail: (panel: React.ReactNode, options: DetailPanelOptions) => void;
  cardMode?: boolean;
}

const STATUS_COLOR: Record<string, string> = {
  added: 'success',
  modified: 'processing',
  changed: 'processing',
  removed: 'error',
  renamed: 'warning',
  copied: 'warning',
};

const STATUS_LABEL: Record<string, string> = {
  added: 'added',
  modified: 'modified',
  changed: 'modified',
  removed: 'removed',
  renamed: 'renamed',
  copied: 'copied',
};

const CodeChangesPanel: React.FC<CodeChangesPanelProps> = ({ sessionId, onOpenDetail, cardMode = false }) => {
  const intl = useIntl();
  const [changes, setChanges] = useState<DevloopTaskChanges | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void getTaskChanges(Number(sessionId))
      .then((response) => {
        if (active) setChanges(response || null);
      })
      .catch((error) => {
        console.error('Failed to load conversation code changes:', error);
        if (active) setChanges(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [sessionId]);

  const files = useMemo(() => changes?.files || [], [changes?.files]);
  const [visibleFileCount, setVisibleFileCount] = useState(20);
  useEffect(() => setVisibleFileCount(20), [sessionId, files.length]);
  const visibleFiles = files.slice(0, visibleFileCount);
  const hasMoreFiles = visibleFileCount < files.length;
  const sentinelRef = useInfiniteScroll(
    () => setVisibleFileCount((current) => Math.min(current + 20, files.length)),
    hasMoreFiles && !loading
  );
  const openDiff = useCallback(
    (filePath: string) => {
      // 每个会话的代码文件使用独立键，避免不同会话打开同名文件时串页签。
      onOpenDetail(<CodeDiffPanel sessionId={sessionId} filePath={filePath} />, {
        tabKey: `session-code:${sessionId}:${filePath}`,
        title: filePath.split('/').pop() || filePath,
      });
    },
    [onOpenDetail, sessionId]
  );

  return (
    <Spin spinning={loading} wrapperClassName={styles.resourceSpin}>
      <List
        className={`${styles.codeList} ${cardMode ? styles.codeCardList : ''}`}
        dataSource={visibleFiles}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={changes?.message || intl.formatMessage({ id: 'chatResource.empty' })}
            />
          ),
        }}
        footer={<div ref={sentinelRef} className={styles.resourceLoadMoreSentinel} />}
        renderItem={(item) => {
          const status = String(item.status || 'modified').toLowerCase();
          const statusLabel = STATUS_LABEL[status];
          return (
            <List.Item
              className={`${styles.codeItem} ${cardMode ? styles.codeCardItem : ''}`}
              onClick={() => openDiff(item.filename)}
            >
              <FileTextOutlined />
              <span className={styles.codeFileName} title={item.filename}>
                {item.filename}
              </span>
              <span className={styles.codeStats}>
                +{item.additions} / -{item.deletions}
              </span>
              <Tag color={STATUS_COLOR[status] || 'default'}>
                {statusLabel
                  ? intl.formatMessage({ id: `projectSpace.detail.codeChanges.status.${statusLabel}` })
                  : item.status}
              </Tag>
            </List.Item>
          );
        }}
      />
    </Spin>
  );
};

export default CodeChangesPanel;
