import React, { useEffect, useState } from 'react';
import { Button, Drawer, Empty, Spin, Tag } from 'antd';
import { MessageOutlined, PauseCircleOutlined, RollbackOutlined } from '@ant-design/icons';
import { getIntl, useIntl } from '@umijs/max';
import dayjs from 'dayjs';
import { getTaskPhases, type DevloopTaskState } from '@/service/devloop';
import { getAgentChatAvatar } from '@/utils/agent';
import styles from './index.module.less';

interface TaskDetailDrawerProps {
  task: any;
  onClose: () => void;
  operationProject?: boolean;
  simpleProject?: boolean;
  canEnterSession?: boolean;
  onEnterSession?: (task: any) => void;
  // 只读查看会话:非处理人可看别人任务的会话消息(无输入框,不能对话)。
  onViewSession?: (task: any) => void;
}

// 同时兼容 v2 阶段状态和旧状态值，任务详情始终按同一视觉语义展示。
const PHASE_STATE_META: Record<string, { cls: string; icon: React.ReactNode; labelId: string }> = {
  completed: { cls: styles.phaseDone, icon: '✓', labelId: 'projectTaskDetail.status.done' },
  done: { cls: styles.phaseDone, icon: '✓', labelId: 'projectTaskDetail.status.done' },
  in_progress: { cls: styles.phaseActive, icon: '●', labelId: 'projectTaskDetail.status.running' },
  running: { cls: styles.phaseActive, icon: '●', labelId: 'projectTaskDetail.status.running' },
  paused: { cls: styles.phasePaused, icon: <PauseCircleOutlined />, labelId: 'projectTaskDetail.status.paused' },
  rejected: { cls: styles.phaseRejected, icon: <RollbackOutlined />, labelId: 'projectTaskDetail.status.rejected' },
  pending: { cls: styles.phaseWaiting, icon: '○', labelId: 'projectTaskDetail.status.pending' },
};

const PHASE_LABEL_IDS: Record<string, string> = {
  issue: 'projectTaskDetail.phase.issue',
  req: 'projectTaskDetail.phase.req',
  design: 'projectTaskDetail.phase.design',
  coder: 'projectTaskDetail.phase.coder',
  reviewer: 'projectTaskDetail.phase.reviewer',
  tester: 'projectTaskDetail.phase.tester',
  pr: 'projectTaskDetail.phase.pr',
};

const dash = (value: any): string => (value === null || value === undefined || value === '' ? '-' : `${value}`);

const parseOperationConfig = (value: unknown): Record<string, any> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

type OperationTaskType = 'collect' | 'knowledge' | 'object_discovery' | 'content' | 'analyze';

const normalizeOperationTaskType = (task: any): OperationTaskType => {
  const taskType = `${task?.taskType || task?.operationType || task?.type || ''}`.trim().toLowerCase();
  if (['content', 'publish', 'creation'].includes(taskType)) return 'content';
  if (
    ['object_discovery', 'object-discovery', 'object discovery'].includes(taskType) ||
    `${task?.templateName || ''}`.includes('对象发现') ||
    `${task?.templateId || ''}` === '-2006'
  ) {
    return 'object_discovery';
  }
  if (['knowledge', 'organize', 'knowledge_organization'].includes(taskType)) return 'knowledge';
  if (['analyze', 'analysis', 'analytics', 'data_analysis'].includes(taskType)) return 'analyze';
  return 'collect';
};

const getOperationConfig = (task: any, taskType: string) => {
  const rootConfig = parseOperationConfig(task?.operationConfig || task?.config);
  const configKeyMap: Record<string, string> = {
    collect: 'collectConfig',
    content: 'contentConfig',
    knowledge: 'knowledgeConfig',
    object_discovery: 'knowledgeConfig',
    analyze: 'analyzeConfig',
  };
  const configKey = configKeyMap[taskType];
  return parseOperationConfig(task?.[configKey] || rootConfig[configKey] || rootConfig);
};

const DETAIL_DATE_TIME_PATTERN = /\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?/g;

// 详情字段可能是完整 ISO 时间，也可能嵌在“单次执行 · 时间”文案中，统一转换到分钟并保留纯日期原样。
const formatDateTimeText = (value: unknown) =>
  `${value ?? ''}`.replace(DETAIL_DATE_TIME_PATTERN, (matched) => {
    const parsed = dayjs(matched);
    return parsed.isValid() ? parsed.format('YYYY-MM-DD HH:mm') : matched;
  });

const formatOperationSchedule = (config: Record<string, any>) => {
  const directSchedule =
    config.publishSchedule || config.collectSchedule || config.scheduleLabel || config.schedule || config.cronExpr;
  if (directSchedule) return formatDateTimeText(directSchedule);

  const runMode = `${config.runMode || config.mode || ''}`.toLowerCase();
  if (runMode === 'once') {
    return config.onceTime
      ? getIntl().formatMessage({ id: 'taskTemplate.schedule.once' }, { v0: formatDateTimeText(config.onceTime) })
      : getIntl().formatMessage({ id: 'taskTemplate.run.once' });
  }
  if (runMode === 'interval') {
    return config.intervalHours
      ? getIntl().formatMessage({ id: 'taskTemplate.schedule.interval' }, { v0: config.intervalHours })
      : getIntl().formatMessage({ id: 'taskTemplate.run.interval' });
  }
  if (runMode === 'period' || runMode === 'periodic')
    return getIntl().formatMessage({ id: 'taskTemplate.run.periodic' });
  return '-';
};

const hasDetailValue = (value: unknown) => {
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
};

const formatDetailValue = (value: unknown): string => {
  if (!hasDetailValue(value)) return '-';
  if (Array.isArray(value))
    return (
      value
        .map(formatDetailValue)
        .filter((item) => item !== '-')
        .join('、') || '-'
    );
  if (value && typeof value === 'object') {
    const record = value as Record<string, any>;
    return `${
      record.objectName ||
      record.resourceName ||
      record.name ||
      record.label ||
      record.objectCode ||
      record.resourceCode ||
      record.code ||
      record.objectId ||
      record.resourceId ||
      record.id ||
      '-'
    }`;
  }
  return formatDateTimeText(value);
};

// 运营任务详情复用任务列表的状态优先级和文案，避免 statusLabel 的历史原文导致两处显示不一致。
const getOperationStatusMeta = (task: any, intl: ReturnType<typeof useIntl>) => {
  const rawStatus = `${
    task?.statusLabel || task?.status || task?.operationState || task?.taskStatus || task?.currentStatus || ''
  }`.trim();
  const status = rawStatus.toLowerCase();
  const statusMeta: Record<string, { labelId: string; color: 'success' | 'processing' | 'warning' | 'error' }> = {
    completed: { labelId: 'projectSpace.detail.task.status.completed', color: 'success' },
    in_progress: { labelId: 'projectSpace.detail.task.status.inProgress', color: 'processing' },
    paused: { labelId: 'projectSpace.detail.task.status.paused', color: 'warning' },
    waiting_confirmation: { labelId: 'projectSpace.detail.task.status.waitingConfirmation', color: 'warning' },
    failed: { labelId: 'projectSpace.detail.task.status.failed', color: 'error' },
    mixed: { labelId: 'projectSpace.detail.task.status.mixed', color: 'warning' },
    pending: { labelId: 'projectSpace.detail.task.status.pending', color: 'warning' },
  };
  let normalizedStatus = status;
  if (status.includes('混合') || status.includes('部分失败')) normalizedStatus = 'mixed';
  else if (
    status.includes('进行中') ||
    status.includes('运行') ||
    ['doing', 'running', 'in_progress'].includes(status)
  ) {
    normalizedStatus = 'in_progress';
  } else if (
    status.includes('已完成') ||
    status.includes('完成') ||
    ['done', 'completed', 'success'].includes(status)
  ) {
    normalizedStatus = 'completed';
  } else if (status.includes('失败') || ['failed', 'error'].includes(status)) {
    normalizedStatus = 'failed';
  } else if (status.includes('暂停') || ['paused'].includes(status)) {
    normalizedStatus = 'paused';
  } else if (status.includes('待确认') || status === 'waiting_confirmation') {
    normalizedStatus = 'waiting_confirmation';
  } else if (
    status.includes('待开始') ||
    status.includes('待启动') ||
    status.includes('待处理') ||
    ['todo', 'pending', 'not_started', 'waiting'].includes(status)
  ) {
    normalizedStatus = 'pending';
  }
  const meta = statusMeta[normalizedStatus] || statusMeta.pending;
  return {
    label: statusMeta[normalizedStatus]
      ? intl.formatMessage({ id: meta.labelId })
      : rawStatus || intl.formatMessage({ id: meta.labelId }),
    color: meta.color,
  };
};

const TaskDetailDrawer: React.FC<TaskDetailDrawerProps> = ({
  task,
  onClose,
  operationProject = false,
  simpleProject = false,
  canEnterSession,
  onEnterSession,
  onViewSession,
}) => {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const [phaseLoading, setPhaseLoading] = useState(false);
  const [snapshot, setSnapshot] = useState<DevloopTaskState | null>(null);

  // 打开抽屉时按 sessionId 定点读取 v2 会话状态投影。
  useEffect(() => {
    if (operationProject || simpleProject || !task?.sessionId || task?.stateAvailable === false) {
      setSnapshot(null);
      setPhaseLoading(false);
      return;
    }

    let cancelled = false;
    setPhaseLoading(true);
    getTaskPhases(Number(task.sessionId))
      .then((res: any) => {
        if (!cancelled) {
          setSnapshot(res?.data ?? res ?? null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPhaseLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [operationProject, simpleProject, task?.sessionId, task?.stateAvailable]);

  const phases = snapshot?.stages || [];
  const currentPhase = snapshot?.currentStage?.stageId;
  const getPhaseLabel = (phaseKey?: string, fallback?: string) => {
    const messageId = PHASE_LABEL_IDS[`${phaseKey || ''}`];
    return messageId ? t(messageId) : fallback || phaseKey || '';
  };
  const currentPhaseLabel = getPhaseLabel(currentPhase, snapshot?.currentStage?.stageName);
  const progress = snapshot?.progress?.percent ?? task?.progress ?? 0;
  const phaseProgressText = currentPhaseLabel
    ? t('projectTaskDetail.progress.phase', { phase: currentPhaseLabel })
    : t('projectTaskDetail.status.notStarted');
  const progressSummary = t('projectTaskDetail.progress.summary', {
    phase: phaseProgressText,
    round: snapshot?.revision ? t('projectTaskDetail.progress.round', { round: snapshot.revision }) : '',
    progress,
  });
  const agentName = task?.agentName || t('projectTaskDetail.defaultAgentName');
  const agentAvatar = task?.avatar || task?.agentAvatar;
  const requirement = task?.requirementTitle || task?.requirementOriginId;
  const operationTaskType = normalizeOperationTaskType(task);
  const rootOperationConfig = parseOperationConfig(task?.operationConfig || task?.config);
  const operationConfig = { ...rootOperationConfig, ...getOperationConfig(task, operationTaskType) };
  const operationTaskTypeLabel = t(`projectSpace.operation.task.type.${operationTaskType}`);
  const operationStatusMeta = getOperationStatusMeta(task, intl);
  const platformCode =
    operationConfig.channel ||
    operationConfig.publishChannel ||
    operationConfig.analysisChannel ||
    operationConfig.platformName ||
    task?.platformName;
  const platformNameMap: Record<string, string> = {
    WeChatAccount: intl.formatMessage({ id: 'projectSpace.operation.platform.wechat' }),
    Xiaohongshu: intl.formatMessage({ id: 'projectSpace.operation.platform.xiaohongshu' }),
    WeChatChannels: intl.formatMessage({ id: 'taskTemplate.platform.channels' }),
    Douyin: intl.formatMessage({ id: 'projectSpace.operation.platform.douyin' }),
  };
  const operationPlatform = platformNameMap[`${platformCode || ''}`] || platformCode;
  const operationAccount =
    operationConfig.publishAccountName ||
    operationConfig.accountName ||
    operationConfig.collectAccountName ||
    task?.accountName ||
    operationConfig.publishAccountId ||
    operationConfig.accountId;
  const operationSchedule = formatOperationSchedule(operationConfig);
  const weekdayLabels = [
    intl.formatMessage({ id: 'projectSpace.operation.taskForm.collect.weekday.1' }),
    intl.formatMessage({ id: 'projectSpace.operation.taskForm.collect.weekday.2' }),
    intl.formatMessage({ id: 'projectSpace.operation.taskForm.collect.weekday.3' }),
    intl.formatMessage({ id: 'projectSpace.operation.taskForm.collect.weekday.4' }),
    intl.formatMessage({ id: 'projectSpace.operation.taskForm.collect.weekday.5' }),
    intl.formatMessage({ id: 'projectSpace.operation.taskForm.collect.weekday.6' }),
    intl.formatMessage({ id: 'projectSpace.operation.taskForm.collect.weekday.7' }),
  ];
  const formatWeekdays = (value: unknown) =>
    Array.isArray(value)
      ? value.map((weekday) => weekdayLabels[Number(weekday) - 1] || `${weekday}`).join('、')
      : value;
  const sourceModeLabelMap: Record<string, string> = {
    knowledge: intl.formatMessage({ id: 'taskTemplate.source.knowledge' }),
    connector: intl.formatMessage({ id: 'taskTemplate.source.connector' }),
    internet: intl.formatMessage({ id: 'taskTemplate.source.internet' }),
  };
  const storageModeLabelMap: Record<string, string> = {
    knowledge: intl.formatMessage({ id: 'projectSpace.resources.knowledge' }),
  };
  const executorTypeLabelMap: Record<string, string> = {
    agent: intl.formatMessage({ id: 'projectTaskDetail.simple.agent' }),
    group: intl.formatMessage({ id: 'taskTemplate.employeeGroup' }),
  };
  const runModeLabelMap: Record<string, string> = {
    once: intl.formatMessage({ id: 'taskTemplate.run.once' }),
    periodic: intl.formatMessage({ id: 'taskTemplate.run.periodic' }),
    period: intl.formatMessage({ id: 'taskTemplate.run.periodic' }),
    interval: intl.formatMessage({ id: 'taskTemplate.run.interval' }),
  };
  const periodTypeLabelMap: Record<string, string> = {
    daily: intl.formatMessage({ id: 'projectSpace.operation.taskForm.collect.period.daily' }),
    weekly: intl.formatMessage({ id: 'projectSpace.operation.taskForm.collect.period.weekly' }),
    biweekly: intl.formatMessage({ id: 'projectSpace.operation.taskForm.collect.period.biweekly' }),
    monthly: intl.formatMessage({ id: 'projectSpace.operation.taskForm.collect.period.monthly' }),
    yearly: intl.formatMessage({ id: 'projectSpace.operation.taskForm.collect.period.yearly' }),
  };
  // 任务基础字段与任务模板结构化字段统一展开；只显示有值项，兼容历史字段别名。
  // 抽屉关闭时父组件会先清空 task，字段计算必须兼容这个短暂的空值状态。
  const operationDetailFields = [
    { label: intl.formatMessage({ id: 'taskTemplate.assignee' }), value: task?.assigneeName || task?.assignee },
    {
      label: intl.formatMessage({ id: 'projectSpace.operation.taskForm.field.dueTime' }),
      value: task?.dueTime ? formatDateTimeText(task.dueTime) : task?.dueTime,
    },
    {
      label: intl.formatMessage({ id: 'projectTaskDetail.simple.createdAt' }),
      value:
        task?.createTime && dayjs(task.createTime).isValid()
          ? dayjs(task.createTime).format('YYYY-MM-DD HH:mm')
          : task?.createTime,
    },
    {
      label: intl.formatMessage({ id: 'taskTemplate.template' }),
      value: operationConfig.templateName || task?.templateName,
    },
    { label: intl.formatMessage({ id: 'taskTemplate.materialSource' }), value: operationConfig.materialSource },
    {
      label: intl.formatMessage({ id: 'projectSpace.operation.taskForm.field.collectMode' }),
      value:
        sourceModeLabelMap[operationConfig.sourceMode] || operationConfig.collectMethod || operationConfig.sourceMode,
    },
    {
      label: intl.formatMessage({ id: 'taskTemplate.sourceKnowledge' }),
      value: operationConfig.sourceKnowledgeName || operationConfig.sourceKnowledge,
    },
    {
      label: intl.formatMessage({ id: 'queryInput.tools.connector' }),
      value: operationConfig.connectorName || operationConfig.connector,
    },
    { label: intl.formatMessage({ id: 'taskTemplate.internetScope' }), value: operationConfig.internetScope },
    {
      label: intl.formatMessage({ id: 'taskTemplate.storageMode' }),
      value: storageModeLabelMap[operationConfig.storageMode] || operationConfig.storageMode,
    },
    {
      label: intl.formatMessage({ id: 'ui.task.targetKnowledge' }),
      value: operationConfig.targetKnowledgeName || operationConfig.targetKnowledge,
    },
    {
      label: intl.formatMessage({ id: 'projectSpace.operation.taskForm.field.contentType' }),
      value: operationConfig.contentType,
    },
    { label: intl.formatMessage({ id: 'taskTemplate.audience' }), value: operationConfig.audience },
    {
      label: intl.formatMessage({ id: 'taskTemplate.platform' }),
      value: operationTaskType === 'content' ? operationConfig.platform || operationPlatform : undefined,
    },
    {
      label: intl.formatMessage({ id: 'projectSpace.operation.taskForm.field.publishAccount' }),
      value: operationTaskType === 'content' ? operationAccount : undefined,
    },
    {
      label: intl.formatMessage({ id: 'projectSpace.operation.taskForm.field.publishSchedule' }),
      value: operationConfig.publishSchedule,
    },
    {
      label: intl.formatMessage({ id: 'taskTemplate.analysisScope' }),
      value: operationConfig.analysisScope || operationConfig.scope,
    },
    { label: intl.formatMessage({ id: 'taskTemplate.timeRange' }), value: operationConfig.range },
    {
      label: intl.formatMessage({ id: 'taskTemplate.executor' }),
      value: executorTypeLabelMap[operationConfig.executorType] || operationConfig.executorType,
    },
    {
      label: intl.formatMessage({ id: 'projectTaskDetail.simple.agent' }),
      value:
        task?.agentName || operationConfig.agentName || operationConfig.executorAgentName || operationConfig.agentId,
    },
    {
      label: intl.formatMessage({ id: 'taskTemplate.employeeGroup' }),
      value: operationConfig.agentGroupName || operationConfig.agentGroupId,
    },
    {
      label: intl.formatMessage({ id: 'projectSpace.detail.integration.run.mode' }),
      value: runModeLabelMap[operationConfig.runMode] || operationConfig.runMode,
    },
    { label: intl.formatMessage({ id: 'taskTemplate.runTime' }), value: operationConfig.onceTime },
    {
      label: intl.formatMessage({ id: 'projectSpace.operation.taskForm.field.collectPeriodType' }),
      value: periodTypeLabelMap[operationConfig.periodType] || operationConfig.periodType,
    },
    { label: intl.formatMessage({ id: 'taskTemplate.timeOfDay' }), value: operationConfig.periodTime },
    {
      label: intl.formatMessage({ id: 'taskTemplate.runDays' }),
      value: formatWeekdays(operationConfig.periodWeekdays),
    },
    { label: intl.formatMessage({ id: 'taskTemplate.runDates' }), value: operationConfig.periodMonthDays },
    { label: intl.formatMessage({ id: 'taskTemplate.yearlyTime' }), value: operationConfig.periodYearDateTime },
    { label: intl.formatMessage({ id: 'taskTemplate.intervalHours' }), value: operationConfig.intervalHours },
    {
      label: intl.formatMessage({ id: 'taskTemplate.intervalDays' }),
      value: formatWeekdays(operationConfig.intervalWeekdays),
    },
    {
      label: intl.formatMessage({ id: 'projectSpace.operation.taskForm.field.collectEffectiveDateRange' }),
      value: operationConfig.effectiveDateRange,
    },
    // 历史任务只有拼接后的调度文案时继续展示，避免执行配置完全缺失。
    {
      label: intl.formatMessage({ id: 'taskTemplate.schedule' }),
      value:
        !operationConfig.publishSchedule && !operationConfig.collectSchedule && operationSchedule !== '-'
          ? operationSchedule
          : undefined,
    },
  ].filter((field) => hasDetailValue(field.value));
  const simpleDetailFields = [
    { label: t('projectTaskDetail.simple.taskId'), value: task?.taskId },
    { label: t('projectTaskDetail.simple.sessionId'), value: task?.sessionId },
    { label: t('projectTaskDetail.simple.taskType'), value: task?.taskType },
    { label: t('projectTaskDetail.simple.owner'), value: task?.assignee },
    { label: t('projectTaskDetail.simple.agent'), value: task?.agentName },
    { label: t('projectTaskDetail.simple.objectType'), value: task?.objectType },
    {
      label: t('projectTaskDetail.simple.createdAt'),
      value: task?.createTime ? formatDateTimeText(task.createTime) : task?.createTime,
    },
    {
      label: t('projectTaskDetail.simple.updatedAt'),
      value: task?.updateTime ? formatDateTimeText(task.updateTime) : task?.updateTime,
    },
  ].filter((field) => hasDetailValue(field.value));

  return (
    <Drawer
      title={t('projectTaskDetail.title')}
      className={styles.taskDetailDrawer}
      open={!!task}
      onClose={onClose}
      width={640}
      extra={
        task?.sessionId ? (
          canEnterSession ? (
            // 处理人:进入可对话会话。
            <Button type="primary" icon={<MessageOutlined />} onClick={() => onEnterSession?.(task)}>
              {t('projectTaskDetail.enterSession')}
            </Button>
          ) : onViewSession ? (
            // 非处理人:只读查看会话(有消息、无输入框)。
            <Button icon={<MessageOutlined />} onClick={() => onViewSession(task)}>
              {t('projectTaskDetail.viewSession')}
            </Button>
          ) : null
        ) : null
      }
    >
      {task && (
        <Spin spinning={phaseLoading}>
          {simpleProject ? (
            <div className={styles.taskDetailDrawerContent}>
              <div className={styles.taskDetailTitle}>
                {task.title || task.taskName || t('projectTaskDetail.defaultTaskName')}
              </div>
              <div className={styles.taskHero}>
                <div className={styles.taskHeroAgent}>
                  <span className={styles.taskHeroAvatar}>{getAgentChatAvatar(agentAvatar)}</span>
                  <div>
                    <small>{t('projectTaskDetail.currentAgent')}</small>
                    <strong>{agentName}</strong>
                  </div>
                </div>
              </div>
              <section className={styles.phaseSection}>
                <h3 className={styles.phaseSectionTitle}>{t('projectTaskDetail.simple.content')}</h3>
                <div className={styles.taskDetailText}>{task.sessionContent || task.description || '-'}</div>
              </section>
              <section className={styles.phaseSection}>
                <h3 className={styles.phaseSectionTitle}>{t('projectTaskDetail.simple.basicInfo')}</h3>
                <div className={styles.taskContextGrid}>
                  {simpleDetailFields.map((field) => (
                    <div key={field.label} className={styles.taskContextItem}>
                      <label>{field.label}</label>
                      <strong>{formatDetailValue(field.value)}</strong>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          ) : operationProject ? (
            <div className={styles.taskDetailDrawerContent}>
              <div className={styles.taskDetailTitle}>
                {task.title || task.taskName || t('projectTaskDetail.defaultTaskName')}
              </div>

              <div className={`${styles.taskHero} ${styles.operationTaskHero}`}>
                <div className={styles.taskHeroAgent}>
                  <span className={styles.taskHeroAvatar}>{getAgentChatAvatar(agentAvatar)}</span>
                  <div>
                    <small>{t('projectTaskDetail.currentAgent')}</small>
                    <strong>{agentName}</strong>
                  </div>
                  <Tag color={operationStatusMeta.color} className={styles.operationTaskStatusTag}>
                    {operationStatusMeta.label}
                  </Tag>
                </div>
              </div>

              <section className={styles.phaseSection}>
                <h3 className={styles.phaseSectionTitle}>{t('projectSpace.operation.task.detail.overview')}</h3>
                <div className={styles.taskContextGrid}>
                  <div className={styles.taskContextItem}>
                    <label>{t('projectSpace.operation.taskForm.field.type')}</label>
                    <strong>{operationTaskTypeLabel}</strong>
                  </div>
                  {operationPlatform && (
                    <div className={styles.taskContextItem}>
                      <label>{t('projectSpace.operation.task.detail.platform')}</label>
                      <strong>{operationPlatform}</strong>
                    </div>
                  )}
                  <div className={`${styles.taskContextItem} ${styles.taskContextItemFull}`}>
                    <label>{t('projectSpace.operation.task.detail.description')}</label>
                    <strong>{task.description || task.taskDescription || '-'}</strong>
                  </div>
                </div>
              </section>

              <section className={styles.phaseSection}>
                <h3 className={styles.phaseSectionTitle}>{t('projectSpace.operation.task.detail.configuration')}</h3>
                <div className={styles.taskContextGrid}>
                  {operationDetailFields.map((field) => (
                    <div key={field.label} className={styles.taskContextItem}>
                      <label>{field.label}</label>
                      <strong>{formatDetailValue(field.value)}</strong>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          ) : (
            <div className={styles.taskDetailDrawerContent}>
              <div className={styles.taskDetailTitle}>
                {task.title || task.taskName || t('projectTaskDetail.defaultTaskName')}
              </div>

              <div className={styles.taskHero}>
                <div className={styles.taskHeroAgent}>
                  <span className={styles.taskHeroAvatar}>{getAgentChatAvatar(agentAvatar)}</span>
                  <div>
                    <small>{t('projectTaskDetail.currentAgent')}</small>
                    <strong>{agentName}</strong>
                  </div>
                </div>
                <div className={styles.taskHeroProgress}>
                  {/* progress 元素承载动态百分比，避免使用内联宽度样式。 */}
                  <progress className={styles.taskHeroProgressBar} value={progress} max={100} />
                  <p>{progressSummary}</p>
                </div>
              </div>

              {snapshot?.status === 'paused' && snapshot.pause && (
                <div className={styles.phaseSection}>
                  <h3 className={styles.phaseSectionTitle}>{t('projectTaskDetail.pause.title')}</h3>
                  <div className={styles.taskContextGrid}>
                    <div className={styles.taskContextItem}>
                      <label>{t('projectTaskDetail.pause.reason')}</label>
                      <strong>{dash(snapshot.pause.reason)}</strong>
                    </div>
                    <div className={styles.taskContextItem}>
                      <label>{t('projectTaskDetail.pause.impact')}</label>
                      <strong>{dash(snapshot.pause.impact)}</strong>
                    </div>
                    <div className={styles.taskContextItem}>
                      <label>{t('projectTaskDetail.pause.resumeCondition')}</label>
                      <strong>{dash(snapshot.pause.resume_condition)}</strong>
                    </div>
                    <div className={styles.taskContextItem}>
                      <label>{t('projectTaskDetail.pause.decisionOwner')}</label>
                      <strong>{dash(snapshot.pause.decision_owner)}</strong>
                    </div>
                  </div>
                </div>
              )}

              <div className={styles.phaseSection}>
                <h3 className={styles.phaseSectionTitle}>{t('projectTaskDetail.context.title')}</h3>
                <div className={styles.taskContextGrid}>
                  <div className={`${styles.taskContextItem} ${styles.taskContextItemFull}`}>
                    <label>{t('projectTaskDetail.context.requirement')}</label>
                    <strong>{dash(requirement)}</strong>
                  </div>
                  <div className={styles.taskContextItem}>
                    <label>{t('projectTaskDetail.context.repository')}</label>
                    <strong>{dash(task.repoFullName)}</strong>
                  </div>
                  <div className={styles.taskContextItem}>
                    <label>{t('projectTaskDetail.context.branch')}</label>
                    <strong>{dash(task.branchName)}</strong>
                  </div>
                  <div className={styles.taskContextItem}>
                    <label>{t('projectTaskDetail.context.owner')}</label>
                    <strong>{dash(task.assignee)}</strong>
                  </div>
                  <div className={styles.taskContextItem}>
                    <label>{t('projectTaskDetail.context.createdAt')}</label>
                    <strong>{task.createTime ? dayjs(task.createTime).format('YYYY-MM-DD HH:mm') : '-'}</strong>
                  </div>
                </div>
              </div>

              <div className={styles.phaseSection}>
                <h3 className={styles.phaseSectionTitle}>{t('projectTaskDetail.progress.title')}</h3>
                {phases.length === 0 ? (
                  <Empty
                    description={
                      task?.stateAvailable === false
                        ? t('projectTaskDetail.emptyState')
                        : t('projectTaskDetail.emptyPhases')
                    }
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                  />
                ) : (
                  <div className={styles.phaseFlow}>
                    {phases.map((phase, index) => {
                      const meta = PHASE_STATE_META[phase.status] || PHASE_STATE_META.pending;
                      const isCurrent = phase.stageId === currentPhase;
                      return (
                        <div key={phase.stageId} className={`${styles.phaseNode} ${meta.cls}`}>
                          <span className={styles.phaseNodeMark}>
                            {['completed', 'done', 'paused', 'rejected'].includes(phase.status) ? meta.icon : index + 1}
                          </span>
                          <div className={styles.phaseNodeBody}>
                            <strong>
                              {getPhaseLabel(phase.stageId, phase.stageName)}
                              {isCurrent && (
                                <span className={styles.phaseCurrentDot}> · {t('projectTaskDetail.current')}</span>
                              )}
                            </strong>
                            <small>
                              {phase.statusLabel || t(meta.labelId)}
                              {phase.activity ? ` · ${phase.activity}` : ''}
                              {phase.loopCount
                                ? ` · ${t('projectTaskDetail.phase.loopCount', { count: phase.loopCount })}`
                                : ''}
                            </small>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </Spin>
      )}
    </Drawer>
  );
};

export default TaskDetailDrawer;
