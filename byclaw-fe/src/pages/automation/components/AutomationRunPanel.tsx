import { Button, Empty, Input, Modal, Skeleton, Tooltip, message } from 'antd';
import {
  CheckOutlined,
  DownOutlined,
  ExclamationCircleOutlined,
  LoadingOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type UIEvent } from 'react';
import { useIntl, useNavigate } from '@umijs/max';
import dayjs from 'dayjs';

import useGlobal from '@/hooks/useGlobal';
import { listMyAutomationRuns } from '@/service/devloop';
import styles from '../index.module.less';

const PAGE_SIZE = 20;

type RunStatus = 'success' | 'failed' | 'running';
type RunStatusFilter = RunStatus | '';

const runStatusOptions: Array<{ key: RunStatusFilter; labelId: string }> = [
  { key: '', labelId: 'automation.run.status.all' },
  { key: 'success', labelId: 'automation.run.status.success' },
  { key: 'failed', labelId: 'automation.run.status.failed' },
  { key: 'running', labelId: 'automation.run.status.running' },
];

interface AutomationRun {
  logId: number;
  sourceId?: number;
  sourceName?: string;
  scanTime?: string;
  status?: string;
  errorMsg?: string;
  // 只有成功下发的记录才有会话；失败行与历史行为空。
  sessionId?: number;
}

interface AutomationRunPanelProps {
  headerLeading?: ReactNode;
}

const getRunDateKey = (value?: string) => {
  const date = dayjs(value);
  return date.isValid() ? date.format('YYYY-MM-DD') : 'unknown';
};

const AutomationRunPanel: React.FC<AutomationRunPanelProps> = ({ headerLeading }) => {
  const intl = useIntl();
  const navigate = useNavigate();
  const { setSessionId } = useGlobal();
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [status, setStatus] = useState<RunStatusFilter>('');
  const [keyword, setKeyword] = useState('');
  const [pageNum, setPageNum] = useState(1);
  const [total, setTotal] = useState(0);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const loadingMoreRef = useRef(false);
  const requestIdRef = useRef(0);

  const loadRuns = useCallback(
    async (targetPage: number, targetStatus: RunStatusFilter, targetKeyword: string, append = false) => {
      if (append && loadingMoreRef.current) return;
      const requestId = ++requestIdRef.current;
      if (append) {
        loadingMoreRef.current = true;
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      try {
        const response: any = await listMyAutomationRuns({
          status: targetStatus || undefined,
          keyword: targetKeyword.trim() || undefined,
          pageNum: targetPage,
          pageSize: PAGE_SIZE,
        });
        if (requestId !== requestIdRef.current) return;
        const data = response?.data ?? response;
        const nextRuns: AutomationRun[] = data?.list || [];
        setRuns((current) => {
          if (!append) return nextRuns;
          const runMap = new Map(current.map((run) => [run.logId, run]));
          nextRuns.forEach((run) => runMap.set(run.logId, run));
          return Array.from(runMap.values());
        });
        setPageNum(targetPage);
        setTotal(Number(data?.total) || 0);
      } catch (error: any) {
        if (requestId !== requestIdRef.current) return;
        message.error(error?.message || intl.formatMessage({ id: 'automation.run.loadFailed' }));
        if (!append) {
          setRuns([]);
          setTotal(0);
        }
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
        if (append) loadingMoreRef.current = false;
      }
    },
    [intl]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void loadRuns(1, status, keyword), 300);
    return () => window.clearTimeout(timer);
  }, [keyword, loadRuns, status]);

  const openRunSession = (run: AutomationRun) => {
    if (!run.sessionId) return;
    setSessionId?.(`${run.sessionId}`);
    navigate('/chat', {
      state: {
        keepSiderActiveKey: 'sessions',
        from: 'automation',
        sessionId: run.sessionId,
      },
    });
  };

  const runGroups = useMemo(() => {
    const groupMap = new Map<string, AutomationRun[]>();

    runs.forEach((run) => {
      const dateKey = getRunDateKey(run.scanTime);
      const groupRuns = groupMap.get(dateKey) || [];
      groupRuns.push(run);
      groupMap.set(dateKey, groupRuns);
    });

    return Array.from(groupMap.entries()).map(([key, items]) => ({ key, items }));
  }, [runs]);

  const getGroupTitle = (dateKey: string) => {
    if (dateKey === 'unknown') return intl.formatMessage({ id: 'automation.run.date.unknown' });
    const value = dayjs(dateKey);
    if (value.isSame(dayjs(), 'day')) return intl.formatMessage({ id: 'automation.run.date.today' });
    if (value.isSame(dayjs().subtract(1, 'day'), 'day')) {
      return intl.formatMessage({ id: 'automation.run.date.yesterday' });
    }
    return value.format('YYYY-MM-DD');
  };

  const getStatusText = (run: AutomationRun) => {
    if (run.status === 'success') return intl.formatMessage({ id: 'automation.run.status.success' });
    if (run.status === 'failed') return intl.formatMessage({ id: 'automation.run.status.failed' });
    if (run.status === 'running') return intl.formatMessage({ id: 'automation.run.status.running' });
    return run.status || '-';
  };

  const renderStatusIcon = (run: AutomationRun) => {
    if (run.status === 'failed') {
      return (
        <button
          type="button"
          className={styles.runFailureButton}
          aria-label={intl.formatMessage({ id: 'automation.run.failureDetail' })}
          title={intl.formatMessage({ id: 'automation.run.failureDetail' })}
          onClick={(event) => {
            event.stopPropagation();
            Modal.error({
              title: intl.formatMessage({ id: 'automation.run.failureDetail' }),
              content: run.errorMsg || intl.formatMessage({ id: 'automation.run.failureUnknown' }),
            });
          }}
        >
          <ExclamationCircleOutlined className={styles.runStatusFailed} />
        </button>
      );
    }
    if (run.status === 'running') {
      return <LoadingOutlined className={styles.runStatusRunning} spin />;
    }
    return <CheckOutlined className={styles.runStatusSuccess} />;
  };

  const toggleGroup = (dateKey: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(dateKey)) next.delete(dateKey);
      else next.add(dateKey);
      return next;
    });
  };

  const prepareQueryChange = () => {
    requestIdRef.current += 1;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setLoading(true);
    setPageNum(1);
    setTotal(0);
  };

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const container = event.currentTarget;
    const reachedBottom = container.scrollHeight - container.scrollTop - container.clientHeight <= 80;
    if (!reachedBottom || loading || loadingMore || runs.length >= total) return;
    void loadRuns(pageNum + 1, status, keyword, true);
  };

  return (
    <div className={styles.runPanel}>
      <div className={styles.toolbar}>
        {headerLeading || (
          <div className={styles.automationTitle}>{intl.formatMessage({ id: 'automation.runRecords' })}</div>
        )}
        <div className={styles.toolbarActions}>
          <Input
            allowClear
            className={styles.searchInput}
            prefix={<SearchOutlined />}
            value={keyword}
            placeholder={intl.formatMessage({ id: 'automation.run.searchPlaceholder' })}
            onChange={(event) => {
              prepareQueryChange();
              setKeyword(event.target.value);
            }}
          />
          <div
            className={styles.runStatusTabs}
            role="tablist"
            aria-label={intl.formatMessage({ id: 'automation.run.filter' })}
          >
            {runStatusOptions.map((item) => (
              <button
                key={item.key || 'all'}
                type="button"
                role="tab"
                aria-selected={status === item.key}
                className={status === item.key ? styles.runStatusTabActive : styles.runStatusTab}
                onClick={() => {
                  if (item.key === status) return;
                  prepareQueryChange();
                  setStatus(item.key);
                }}
              >
                {intl.formatMessage({ id: item.labelId })}
              </button>
            ))}
          </div>
          <Button
            className={styles.toolbarIconButton}
            icon={<ReloadOutlined />}
            loading={loading}
            aria-label={intl.formatMessage({ id: 'common.refresh' })}
            title={intl.formatMessage({ id: 'common.refresh' })}
            onClick={() => void loadRuns(1, status, keyword)}
          />
        </div>
      </div>
      <div className={styles.runContent} onScroll={handleScroll}>
        {loading && !runs.length ? (
          <div className={styles.automationSkeleton}>
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} active title={false} paragraph={{ rows: 1, width: '100%' }} />
            ))}
          </div>
        ) : !runGroups.length ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={intl.formatMessage({ id: 'automation.run.empty' })}
          />
        ) : (
          <div className={styles.runGroups}>
            {runGroups.map((group) => {
              const collapsed = collapsedGroups.has(group.key);
              return (
                <section key={group.key} className={styles.runGroup}>
                  <button type="button" className={styles.runGroupTitle} onClick={() => toggleGroup(group.key)}>
                    <span>{getGroupTitle(group.key)}</span>
                    <DownOutlined className={collapsed ? styles.runGroupArrowCollapsed : styles.runGroupArrow} />
                  </button>
                  {!collapsed && (
                    <div className={styles.runList}>
                      {group.items.map((run) => (
                        <div
                          key={run.logId}
                          className={`${styles.runRow} ${run.sessionId ? styles.runRowClickable : ''}`}
                          role={run.sessionId ? 'button' : undefined}
                          tabIndex={run.sessionId ? 0 : undefined}
                          onClick={() => openRunSession(run)}
                          onKeyDown={(event) => {
                            if (!run.sessionId || (event.key !== 'Enter' && event.key !== ' ')) return;
                            event.preventDefault();
                            openRunSession(run);
                          }}
                        >
                          <div className={styles.runMain}>
                            <span className={styles.runName}>{run.sourceName || '-'}</span>
                            <Tooltip title={run.errorMsg || undefined}>
                              <span className={styles.runStatusText}>{getStatusText(run)}</span>
                            </Tooltip>
                          </div>
                          <div className={styles.runMeta}>
                            <span>{dayjs(run.scanTime).isValid() ? dayjs(run.scanTime).format('HH:mm') : '-'}</span>
                            <span className={styles.runStatusIcon}>{renderStatusIcon(run)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
        {loadingMore && (
          <div className={styles.runLoadingMore}>
            <LoadingOutlined spin />
          </div>
        )}
      </div>
    </div>
  );
};

export default AutomationRunPanel;
