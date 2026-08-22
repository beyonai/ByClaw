import { Button, Dropdown, Empty, Input, Modal, Skeleton, Switch, message } from 'antd';
import {
  CheckOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  DownOutlined,
  EllipsisOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SortAscendingOutlined,
  SortDescendingOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useIntl, useSelector } from '@umijs/max';
import { deleteScanSource, listScanSources, toggleScanSource, triggerScan } from '@/service/devloop';
import AutomationEditor from './AutomationEditor';
import {
  getAutomationListGroup,
  getAutomationSchedule,
  getNextRunTime,
  isAutomationEnabled,
  parseAutomationConfig,
  resolveAutomationPromptDisplayText,
} from '../schedule';
import type { AutomationSource } from '../types';
import styles from '../index.module.less';

interface PanelProps {
  active?: boolean;
  headerLeading?: ReactNode;
}

const normalizeRows = (response: any): AutomationSource[] => {
  const data = response?.data ?? response;
  const rows = Array.isArray(data) ? data : data?.list || data?.rows || data?.records || [];
  return rows;
};

const getRelativeTime = (target: Dayjs, now: Dayjs) => {
  const totalMinutes = Math.max(0, target.diff(now, 'minute'));
  const days = Math.floor(totalMinutes / (24 * 60));
  if (days > 0) return { count: days, unit: 'days' as const };
  const hours = Math.floor(totalMinutes / 60);
  if (hours > 0) return { count: hours, unit: 'hours' as const };
  return { count: Math.max(1, totalMinutes), unit: 'minutes' as const };
};

type AutomationSortOrder = 'desc' | 'asc';

const getSourceCreateTime = (source: AutomationSource) => {
  if (source.createTime === undefined || source.createTime === null || source.createTime === '') {
    return undefined;
  }
  if (typeof source.createTime === 'number' && Number.isFinite(source.createTime)) {
    return source.createTime;
  }
  if (typeof source.createTime === 'string' && /^\d+$/.test(source.createTime)) {
    const timestamp = Number(source.createTime);
    return Number.isFinite(timestamp) ? timestamp : undefined;
  }
  const parsed = dayjs(source.createTime);
  return parsed.isValid() ? parsed.valueOf() : undefined;
};

const sortAutomationSources = (rows: AutomationSource[], order: AutomationSortOrder) =>
  [...rows].sort((left, right) => {
    const leftTime = getSourceCreateTime(left);
    const rightTime = getSourceCreateTime(right);

    if (leftTime !== undefined && rightTime !== undefined && leftTime !== rightTime) {
      return order === 'desc' ? rightTime - leftTime : leftTime - rightTime;
    }
    if (leftTime !== undefined || rightTime !== undefined) {
      return leftTime === undefined ? 1 : -1;
    }

    const leftId = Number(left.sourceId);
    const rightId = Number(right.sourceId);
    if (Number.isFinite(leftId) && Number.isFinite(rightId) && leftId !== rightId) {
      return order === 'desc' ? rightId - leftId : leftId - rightId;
    }
    return 0;
  });

const AutomationListPanel: React.FC<PanelProps> = ({ active = true, headerLeading }) => {
  const intl = useIntl();
  const userInfo = useSelector(({ user }: any) => user.userInfo);
  const employees = useSelector(({ employees: employeeState }: any) => [
    ...(employeeState?.agentList || []),
    ...(employeeState?.employeesList || []),
  ]);
  const currentUserId = userInfo?.userId ?? userInfo?.id;
  const [loading, setLoading] = useState(false);
  const [sources, setSources] = useState<AutomationSource[]>([]);
  const [keyword, setKeyword] = useState('');
  const [sortOrder, setSortOrder] = useState<AutomationSortOrder>('desc');
  const [editingSource, setEditingSource] = useState<AutomationSource>();
  const [editorOpen, setEditorOpen] = useState(false);
  const [togglingSourceIds, setTogglingSourceIds] = useState<Set<string>>(new Set());
  const toggleTimersRef = useRef<Record<string, number>>({});

  const isSourceOwner = useCallback(
    (source: AutomationSource) => {
      // 存量自动化及旧版接口可能没有回传 createBy，不能因此把批量复选框和全部管理入口都隐藏。
      // 缺失时先按可管理展示，真正的修改和删除仍由后端 requireSourceCreator 做最终权限校验。
      if (source.createBy === undefined || source.createBy === null || `${source.createBy}` === '') return true;
      return currentUserId !== undefined && currentUserId !== null && `${currentUserId}` === `${source.createBy}`;
    },
    [currentUserId]
  );

  const reload = useCallback(
    async (searchKeyword = keyword) => {
      setLoading(true);
      try {
        const response = await listScanSources({
          keyword: searchKeyword.trim() || undefined,
          onlyMine: true,
          pageNum: 1,
          pageSize: 100,
        });
        setSources(normalizeRows(response));
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'automation.loadFailed' }));
        setSources([]);
      } finally {
        setLoading(false);
      }
    },
    [intl, keyword]
  );

  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setTimeout(() => void reload(keyword), 300);
    return () => window.clearTimeout(timer);
  }, [active, keyword, reload]);

  useEffect(
    () => () => {
      Object.values(toggleTimersRef.current).forEach((timer) => window.clearTimeout(timer));
      toggleTimersRef.current = {};
    },
    []
  );

  const openEditor = (source?: AutomationSource) => {
    setEditingSource(source);
    setEditorOpen(true);
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setEditingSource(undefined);
  };

  const deleteOne = useCallback(
    async (source: AutomationSource) => {
      await deleteScanSource(Number(source.sourceId));
      message.success(intl.formatMessage({ id: 'automation.deleteSuccess' }));
    },
    [intl]
  );

  const confirmDelete = (source: AutomationSource) => {
    Modal.confirm({
      title: intl.formatMessage({ id: 'automation.deleteTitle' }),
      content: intl.formatMessage(
        { id: 'automation.deleteContent' },
        { name: source.sourceName || intl.formatMessage({ id: 'automation.defaultName' }, { id: source.sourceId }) }
      ),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteOne(source);
          await reload();
        } catch (error: any) {
          message.error(error?.message || intl.formatMessage({ id: 'automation.deleteFailed' }));
        }
      },
    });
  };

  const toggleSource = useCallback(
    (source: AutomationSource, enabled: boolean) => {
      const sourceId = `${source.sourceId}`;
      const previousTimer = toggleTimersRef.current[sourceId];
      if (previousTimer) window.clearTimeout(previousTimer);
      setTogglingSourceIds((current) => new Set(current).add(sourceId));

      toggleTimersRef.current[sourceId] = window.setTimeout(async () => {
        try {
          await toggleScanSource(Number(source.sourceId), enabled ? '1' : '0');
          await reload();
        } catch (error: any) {
          message.error(error?.message || intl.formatMessage({ id: 'automation.saveFailed' }));
        } finally {
          delete toggleTimersRef.current[sourceId];
          setTogglingSourceIds((current) => {
            const next = new Set(current);
            next.delete(sourceId);
            return next;
          });
        }
      }, 300);
    },
    [intl, reload]
  );

  const runSource = useCallback(
    async (source: AutomationSource) => {
      try {
        await triggerScan(Number(source.sourceId));
        message.success(intl.formatMessage({ id: 'automation.triggerSuccess' }));
        await reload();
      } catch (error: any) {
        message.error(error?.message || intl.formatMessage({ id: 'automation.saveFailed' }));
      }
    },
    [intl, reload]
  );

  const formatSchedule = (source: AutomationSource) => {
    const schedule = getAutomationSchedule(source);
    if (!schedule) return intl.formatMessage({ id: 'automation.schedule.unknown' });

    const time = schedule.time || '09:00';
    let label = intl.formatMessage({ id: 'automation.schedule.unknown' });
    if (schedule.mode === 'once') {
      const onceTime = dayjs(schedule.onceTime);
      label = onceTime.isValid()
        ? `${intl.formatMessage({ id: 'automation.schedule.once' })} · ${onceTime.format('YYYY/M/D HH:mm:ss')}`
        : intl.formatMessage({ id: 'automation.schedule.unknown' });
    } else if (schedule.mode === 'interval') {
      const intervalValue = schedule.intervalValue || schedule.intervalHours || 1;
      const unit = schedule.intervalUnit || 'hour';
      label = `${intl.formatMessage({ id: 'automation.schedule.interval' })} · ${intervalValue} ${intl.formatMessage({
        id: `automation.intervalUnit.${unit}`,
      })}`;
    } else if (schedule.periodType === 'daily') {
      label = intl.formatMessage({ id: 'automation.schedule.dailyAt' }, { time });
    } else if (schedule.periodType === 'weekly' || schedule.periodType === 'biweekly') {
      const separator = intl.formatMessage({ id: 'automation.schedule.listSeparator' });
      const weekdays = (schedule.weekdays?.length ? schedule.weekdays : [1, 2, 3, 4, 5, 6, 7])
        .map((day) => intl.formatMessage({ id: `automation.weekday.${day}` }))
        .join(separator);
      label = intl.formatMessage({ id: 'automation.schedule.weeklyAt' }, { weekdays, time });
    } else if (schedule.periodType === 'monthly') {
      const days = schedule.monthDays?.length ? schedule.monthDays : [schedule.monthDay || 1];
      label = intl.formatMessage(
        { id: 'automation.schedule.monthlyAt' },
        { day: days.join(intl.formatMessage({ id: 'automation.schedule.listSeparator' })), time }
      );
    } else if (schedule.periodType === 'yearly') {
      label = intl.formatMessage(
        { id: 'automation.schedule.yearlyAt' },
        { month: schedule.month || 1, day: schedule.monthDay || 1, time }
      );
    }

    return label;
  };

  const sortedSources = sortAutomationSources(sources, sortOrder);
  const sortLabelId = sortOrder === 'desc' ? 'automation.sort.createdDesc' : 'automation.sort.createdAsc';
  const sortIcon = sortOrder === 'desc' ? <SortDescendingOutlined /> : <SortAscendingOutlined />;

  const renderTaskRow = (source: AutomationSource) => {
    const sourceId = `${source.sourceId}`;
    const owner = isSourceOwner(source);
    const canEdit = source.sourceType === 'chat';
    const enabled = isAutomationEnabled(source);
    const group = getAutomationListGroup(source);
    const nextRun = getNextRunTime(source);
    const relativeTime = nextRun ? getRelativeTime(nextRun, dayjs()) : undefined;
    const relativeTimeText = relativeTime
      ? intl.formatMessage({ id: `automation.time.${relativeTime.unit}` }, { count: relativeTime.count })
      : '';
    const rightText =
      group === 'running'
        ? intl.formatMessage({ id: 'automation.running' })
        : group === 'paused'
          ? intl.formatMessage({ id: 'automation.paused' })
          : enabled && nextRun
            ? intl.formatMessage({ id: 'automation.nextRunAt' }, { time: relativeTimeText })
            : intl.formatMessage({ id: 'automation.noNextRun' });
    const automationConfig = parseAutomationConfig(source.config);
    const taskDescription = resolveAutomationPromptDisplayText(
      automationConfig.chatContent.trim(),
      automationConfig.resourceList,
      employees
    );

    return (
      <div
        key={sourceId}
        className={`${styles.taskRow} ${owner ? styles.taskRowWithActions : ''}`}
        role={owner && canEdit ? 'button' : undefined}
        tabIndex={owner && canEdit ? 0 : undefined}
        onClick={() => {
          if (owner && canEdit) openEditor(source);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          if (owner && canEdit) openEditor(source);
        }}
      >
        <div className={styles.taskTop}>
          {owner ? (
            <Switch
              className={styles.taskSwitch}
              checked={enabled}
              loading={togglingSourceIds.has(sourceId)}
              onClick={(_, event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              onChange={(checked) => void toggleSource(source, checked)}
              aria-label={intl.formatMessage({ id: enabled ? 'automation.pause' : 'automation.resume' })}
            />
          ) : (
            <span />
          )}
          {owner && (
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  {
                    key: 'run',
                    icon: <PlayCircleOutlined />,
                    label: intl.formatMessage({ id: 'automation.runNow' }),
                    disabled: !enabled,
                  },
                  {
                    key: 'delete',
                    icon: <DeleteOutlined />,
                    label: intl.formatMessage({ id: 'automation.deleteTask' }),
                    danger: true,
                  },
                ],
                onClick: async ({ key, domEvent }) => {
                  domEvent.stopPropagation();
                  if (key === 'run' && enabled) await runSource(source);
                  if (key === 'delete') confirmDelete(source);
                },
              }}
            >
              <Button
                type="text"
                size="small"
                className={styles.rowActionButton}
                icon={<EllipsisOutlined />}
                aria-label={intl.formatMessage({ id: 'common.more' })}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              />
            </Dropdown>
          )}
        </div>
        <div className={styles.taskMain}>
          <span className={styles.taskName}>{source.sourceName || '-'}</span>
          <span className={styles.taskDescription}>{taskDescription || '-'}</span>
        </div>
        <div className={styles.taskFooter}>
          <span className={styles.schedulePill}>
            <ClockCircleOutlined />
            <span>{formatSchedule(source)}</span>
          </span>
          <span className={styles.nextRun}>{rightText}</span>
        </div>
      </div>
    );
  };

  if (editorOpen) {
    return (
      <AutomationEditor
        source={editingSource}
        onCancel={closeEditor}
        onSaved={async () => {
          closeEditor();
          await reload();
        }}
      />
    );
  }

  return (
    <div className={styles.automationPanel}>
      <div className={styles.toolbar}>
        {headerLeading || (
          <div className={styles.automationTitle}>{intl.formatMessage({ id: 'automation.scheduledTasks' })}</div>
        )}
        <div className={styles.toolbarActions}>
          <Input
            allowClear
            className={styles.searchInput}
            prefix={<SearchOutlined />}
            value={keyword}
            placeholder={intl.formatMessage({ id: 'automation.searchPlaceholder' })}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <Dropdown
            trigger={['click']}
            placement="bottomLeft"
            menu={{
              items: [
                {
                  key: 'desc',
                  label: (
                    <span className={styles.sortMenuItem}>
                      <span>{intl.formatMessage({ id: 'automation.sort.createdDesc' })}</span>
                      {sortOrder === 'desc' && <CheckOutlined className={styles.sortMenuCheck} />}
                    </span>
                  ),
                },
                {
                  key: 'asc',
                  label: (
                    <span className={styles.sortMenuItem}>
                      <span>{intl.formatMessage({ id: 'automation.sort.createdAsc' })}</span>
                      {sortOrder === 'asc' && <CheckOutlined className={styles.sortMenuCheck} />}
                    </span>
                  ),
                },
              ],
              onClick: ({ key }) => setSortOrder(key as AutomationSortOrder),
            }}
          >
            <Button className={styles.sortButton} icon={sortIcon}>
              <span>{intl.formatMessage({ id: sortLabelId })}</span>
              <DownOutlined className={styles.sortButtonArrow} />
            </Button>
          </Dropdown>
          <Button
            className={styles.toolbarIconButton}
            icon={<ReloadOutlined />}
            loading={loading}
            aria-label={intl.formatMessage({ id: 'common.refresh' })}
            title={intl.formatMessage({ id: 'common.refresh' })}
            onClick={() => void reload()}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor()}>
            {intl.formatMessage({ id: 'automation.add' })}
          </Button>
        </div>
      </div>
      <div className={styles.listContent}>
        {loading && !sources.length ? (
          <div className={styles.automationSkeleton}>
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} active title={false} paragraph={{ rows: 1, width: '100%' }} />
            ))}
          </div>
        ) : !sources.length ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={intl.formatMessage({ id: 'automation.empty' })} />
        ) : (
          <div className={styles.automationList}>{sortedSources.map((source) => renderTaskRow(source))}</div>
        )}
      </div>
    </div>
  );
};

export default AutomationListPanel;
