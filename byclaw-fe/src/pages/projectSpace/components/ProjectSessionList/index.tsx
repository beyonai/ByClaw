import { Button, Empty, Spin, Tag, Typography } from 'antd';
import { MessageOutlined, ReloadOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useIntl } from '@umijs/max';
import { listProjectSessionsByQo } from '@/service/devloop';
import type { ProjectSession } from '../../types';
import { getArrayData, getPageTotal, normalizeProjectSession } from '../../utils';
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll';
import styles from '../../index.module.less';

const PAGE_SIZE = 20;

interface Props {
  projectId: string;
  sessions: ProjectSession[];
  loading?: boolean;
  keyword?: string;
  onRefresh?: () => void;
  onOpenSession?: (session: ProjectSession) => void;
}

const ProjectSessionList: React.FC<Props> = ({
  projectId,
  sessions,
  loading,
  keyword = '',
  onRefresh,
  onOpenSession,
}) => {
  const intl = useIntl();
  const [sessionItems, setSessionItems] = useState(sessions);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(sessions.length);
  const [loadingMore, setLoadingMore] = useState(false);
  const requestingRef = useRef(false);

  const loadSessions = useCallback(
    async (nextPage = 1) => {
      if (!projectId || (nextPage > 1 && requestingRef.current)) return;
      if (nextPage > 1) requestingRef.current = true;
      if (nextPage > 1) setLoadingMore(true);
      try {
        const response = await listProjectSessionsByQo({
          projectId: Number(projectId),
          pageNum: nextPage,
          pageSize: PAGE_SIZE,
          keyword: keyword.trim() || undefined,
        });
        const rows = getArrayData(response).map((item) => normalizeProjectSession(item, projectId));
        setSessionItems((current) => (nextPage === 1 ? rows : [...current, ...rows]));
        setPage(nextPage);
        const loadedCount = (nextPage - 1) * PAGE_SIZE + rows.length;
        setTotal(getPageTotal(response, loadedCount + (rows.length === PAGE_SIZE ? 1 : 0)));
      } catch (error) {
        // 详情接口已经提供首屏会话，分页失败时保留当前卡片，刷新仍可通过项目详情入口重试。
        console.error('Failed to load project sessions:', error);
      } finally {
        if (nextPage > 1) requestingRef.current = false;
        if (nextPage > 1) setLoadingMore(false);
      }
    },
    [keyword, projectId]
  );

  useEffect(() => {
    setSessionItems(sessions);
    setPage(0);
    setTotal(sessions.length);
    const timer = window.setTimeout(() => void loadSessions(1), 250);
    return () => window.clearTimeout(timer);
  }, [loadSessions, sessions]);

  const hasMore = total > sessionItems.length || (total === 0 && sessionItems.length === PAGE_SIZE);
  const sentinelRef = useInfiniteScroll(() => {
    if (hasMore) void loadSessions(page + 1);
  }, hasMore && !loading && !loadingMore);

  if (!sessionItems.length) {
    return (
      <div className={styles.sessionEmpty}>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={intl.formatMessage({ id: 'projectSpace.sessions.empty' })}
        />
        <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadSessions(1).then(onRefresh)}>
          {intl.formatMessage({ id: 'projectSpace.detail.refresh' })}
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.sessionListWrap}>
      <div className={styles.sessionToolbar}>
        <Typography.Text type="secondary">
          {intl.formatMessage({ id: 'projectSpace.sessions.total' }, { count: total || sessionItems.length })}
        </Typography.Text>
        <Button
          size="small"
          icon={<ReloadOutlined />}
          loading={loading}
          onClick={() => void loadSessions(1).then(onRefresh)}
        >
          {intl.formatMessage({ id: 'projectSpace.detail.refresh' })}
        </Button>
      </div>
      <div className={styles.dataCardGrid}>
        {sessionItems.map((session) => (
          <article
            key={session.sessionId}
            className={`${styles.dataCard} ${styles.sessionCard}`}
            onClick={() => onOpenSession?.(session)}
          >
            <div className={styles.dataCardHeader}>
              <Typography.Text strong ellipsis={{ tooltip: session.sessionName }}>
                {session.sessionName}
              </Typography.Text>
              {session.taskId ? (
                <Tag bordered={false}>{intl.formatMessage({ id: 'projectSpace.sessions.taskSession' })}</Tag>
              ) : null}
            </div>
            <Typography.Paragraph className={styles.dataCardDescription} ellipsis={{ rows: 2 }}>
              {session.sessionContent || intl.formatMessage({ id: 'projectSpace.sessions.noSummary' })}
            </Typography.Paragraph>
            <div className={styles.dataCardFooter}>
              <Tag bordered={false}>
                {intl.formatMessage({ id: 'projectSpace.sessions.fileCount' }, { count: session.fileCount || 0 })}
              </Tag>
              <Button
                type="link"
                size="small"
                icon={<MessageOutlined />}
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenSession?.(session);
                }}
              >
                {intl.formatMessage({ id: 'projectSpace.sessions.open' })}
              </Button>
            </div>
          </article>
        ))}
      </div>
      <div ref={sentinelRef} className={styles.loadMoreSentinel}>
        {loadingMore ? <Spin size="small" /> : null}
      </div>
    </div>
  );
};

export default ProjectSessionList;
