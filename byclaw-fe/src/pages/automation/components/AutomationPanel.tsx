import { Button, Dropdown, Empty, Input, Modal, Skeleton, message } from 'antd';
import {
  DeleteOutlined,
  MoreOutlined,
  PauseCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { useCallback, useEffect, useState } from 'react';
import { useIntl, useSelector } from '@umijs/max';
import AntdIcon from '@/components/AntdIcon';
import { deleteScanSource, listScanSources, toggleScanSource, triggerScan } from '@/service/devloop';
import AutomationEditor from './AutomationEditor';
import { getAutomationListGroup, getAutomationSchedule, getNextRunTime, isAutomationEnabled } from '../schedule';
import type { AutomationSource } from '../types';
import styles from '../index.module.less';

interface PanelProps {
  active?: boolean;
}

const normalizeRows = (response: any): AutomationSource[] => {
  const data = response?.data ?? response;
  const rows = Array.isArray(data) ? data : data?.list || data?.rows || data?.records || [];
  return rows;
};

const formatSourceCreateTime = (source: AutomationSource) => {
  if (!source.createTime) return '';
  const value = dayjs(source.createTime);
  return value.isValid() ? value.format('YYYY-MM-DD HH:mm:ss') : '';
};

const getRelativeTime = (target: Dayjs, now: Dayjs) => {
  const totalMinutes = Math.max(0, target.diff(now, 'minute'));
  const days = Math.floor(totalMinutes / (24 * 60));
  if (days > 0) return { count: days, unit: 'days' as const };
  const hours = Math.floor(totalMinutes / 60);
  if (hours > 0) return { count: hours, unit: 'hours' as const };
  return { count: Math.max(1, totalMinutes), unit: 'minutes' as const };
};

const AutomationListPanel: React.FC<PanelProps> = ({ active = true }) => {
  const intl = useIntl();
  const userInfo = useSelector(({ user }: any) => user.userInfo);
  const currentUserId = userInfo?.userId ?? userInfo?.id;
  const [loading, setLoading] = useState(false);
  const [sources, setSources] = useState<AutomationSource[]>([]);
  const [keyword, setKeyword] = useState('');
  const [editingSource, setEditingSource] = useState<AutomationSource>();
  const [editorOpen, setEditorOpen] = useState(false);

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
      label = intl.formatMessage({ id: 'automation.schedule.everyHours' }, { hours: schedule.intervalHours || 1 });
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

    if (schedule.effectiveStartDate || schedule.effectiveEndDate) {
      label += ` · ${intl.formatMessage(
        { id: 'automation.effectivePeriod' },
        { start: schedule.effectiveStartDate || '-', end: schedule.effectiveEndDate || '-' }
      )}`;
    }
    return label;
  };

  const renderTaskRow = (source: AutomationSource, group: 'running' | 'current' | 'paused') => {
    const sourceId = `${source.sourceId}`;
    const owner = isSourceOwner(source);
    const canEdit = source.sourceType === 'chat';
    const enabled = isAutomationEnabled(source);
    const nextRun = getNextRunTime(source);
    const sourceTime = formatSourceCreateTime(source);
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
        <div className={styles.taskMain}>
          <span className={styles.taskName}>{source.sourceName || '-'}</span>
          {sourceTime && <span className={styles.taskMeta}>{sourceTime}</span>}
          <span className={styles.taskMeta}>{formatSchedule(source)}</span>
        </div>
        <span className={styles.nextRun}>{rightText}</span>
        <div className={styles.rowActions} onClick={(event) => event.stopPropagation()}>
          {owner && (
            <Button
              type="text"
              size="small"
              className={styles.rowActionButton}
              icon={<AntdIcon type="icon-a-Play-onebofang" />}
              aria-label={intl.formatMessage({ id: enabled ? 'automation.runNow' : 'automation.resume' })}
              onClick={async () => {
                if (enabled) {
                  await triggerScan(Number(source.sourceId));
                  message.success(intl.formatMessage({ id: 'automation.triggerSuccess' }));
                } else {
                  await toggleScanSource(Number(source.sourceId), '1');
                }
                await reload();
              }}
            />
          )}
          {owner && (
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  {
                    key: 'toggle',
                    icon: enabled ? <PauseCircleOutlined /> : <ReloadOutlined />,
                    label: intl.formatMessage({ id: enabled ? 'automation.pause' : 'automation.resume' }),
                  },
                  {
                    key: 'delete',
                    icon: <DeleteOutlined />,
                    label: intl.formatMessage({ id: 'common.delete' }),
                    danger: true,
                  },
                ],
                onClick: async ({ key, domEvent }) => {
                  domEvent.stopPropagation();
                  if (key === 'delete') confirmDelete(source);
                  if (key === 'toggle') {
                    await toggleScanSource(Number(source.sourceId), enabled ? '0' : '1');
                    await reload();
                  }
                },
              }}
            >
              <Button type="text" size="small" className={styles.rowActionButton} icon={<MoreOutlined />} />
            </Dropdown>
          )}
        </div>
      </div>
    );
  };

  const taskGroups = [
    {
      key: 'running' as const,
      title: intl.formatMessage({ id: 'automation.running' }),
      items: sources.filter((source) => getAutomationListGroup(source) === 'running'),
    },
    {
      key: 'current' as const,
      title: intl.formatMessage({ id: 'automation.current' }),
      items: sources.filter((source) => getAutomationListGroup(source) === 'current'),
    },
    {
      key: 'paused' as const,
      title: intl.formatMessage({ id: 'automation.paused' }),
      items: sources.filter((source) => getAutomationListGroup(source) === 'paused'),
    },
  ].filter((group) => group.items.length > 0);

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
        <div className={styles.automationTitle}>{intl.formatMessage({ id: 'automation.scheduledTasks' })}</div>
        <div className={styles.toolbarActions}>
          <Input
            allowClear
            className={styles.searchInput}
            prefix={<SearchOutlined />}
            value={keyword}
            placeholder={intl.formatMessage({ id: 'automation.searchPlaceholder' })}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void reload()}>
            {intl.formatMessage({ id: 'common.refresh' })}
          </Button>
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
          <div className={styles.automationGroups}>
            {taskGroups.map((group) => (
              <section key={group.key} className={styles.taskGroup}>
                <div className={styles.listGroupTitle}>{group.title}</div>
                <div className={styles.automationList}>
                  {group.items.map((source) => renderTaskRow(source, group.key))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AutomationListPanel;
