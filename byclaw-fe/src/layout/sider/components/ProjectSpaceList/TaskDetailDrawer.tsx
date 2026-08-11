import React, { useEffect, useState } from 'react';
import { Button, Drawer, Empty, Spin, Tag } from 'antd';
import { MessageOutlined, PauseCircleOutlined, RollbackOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import dayjs from 'dayjs';
import { getTaskPhases, type DevloopTaskState } from '@/service/devloop';
import { getAgentChatAvatar } from '@/utils/agent';
import styles from './index.module.less';

interface TaskDetailDrawerProps {
  task: any;
  onClose: () => void;
  operationProject?: boolean;
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

type OperationTaskType = 'collect' | 'knowledge' | 'content' | 'analyze';

const normalizeOperationTaskType = (task: any): OperationTaskType => {
  const taskType = `${task?.taskType || task?.operationType || task?.type || ''}`.trim().toLowerCase();
  if (['content', 'publish', 'creation'].includes(taskType)) return 'content';
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
    analyze: 'analyzeConfig',
  };
  const configKey = configKeyMap[taskType];
  return parseOperationConfig(task?.[configKey] || rootConfig[configKey] || rootConfig);
};

const formatOperationSchedule = (config: Record<string, any>) => {
  const directSchedule =
    config.publishSchedule || config.collectSchedule || config.scheduleLabel || config.schedule || config.cronExpr;
  if (directSchedule) return `${directSchedule}`;

  const runMode = `${config.runMode || config.mode || ''}`.toLowerCase();
  if (runMode === 'once') return config.onceTime ? `单次执行 · ${config.onceTime}` : '单次执行';
  if (runMode === 'interval') {
    return config.intervalHours ? `按间隔执行 · 每 ${config.intervalHours} 小时` : '按间隔执行';
  }
  if (runMode === 'period' || runMode === 'periodic') return '按周期执行';
  return '-';
};

const hasDetailValue = (value: unknown) => {
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
};

const formatDetailValue = (value: unknown): string => {
  if (!hasDetailValue(value)) return '-';
  if (Array.isArray(value)) return value.map(formatDetailValue).filter((item) => item !== '-').join('、') || '-';
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
  return `${value}`;
};

const getOperationStatusMeta = (task: any) => {
  const rawStatus = `${
    task?.statusLabel || task?.status || task?.operationState || task?.taskStatus || task?.currentStatus || ''
  }`.trim();
  const status = rawStatus.toLowerCase();
  const localizedLabel = (fallback: string) => (/[一-鿿]/.test(rawStatus) ? rawStatus : fallback);
  if (status.includes('完成') || ['done', 'completed', 'success'].includes(status)) {
    return { label: localizedLabel('已完成'), color: 'success' as const };
  }
  if (status.includes('失败') || ['failed', 'error'].includes(status)) {
    return { label: localizedLabel('失败'), color: 'error' as const };
  }
  if (status.includes('进行') || ['doing', 'running', 'in_progress'].includes(status)) {
    return { label: localizedLabel('进行中'), color: 'processing' as const };
  }
  if (status.includes('暂停') || ['paused', 'waiting_confirmation'].includes(status)) {
    return { label: localizedLabel('暂停'), color: 'warning' as const };
  }
  return { label: localizedLabel('待开始'), color: 'warning' as const };
};

const TaskDetailDrawer: React.FC<TaskDetailDrawerProps> = ({
  task,
  onClose,
  operationProject = false,
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
    if (operationProject || !task?.sessionId || task?.stateAvailable === false) {
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
  }, [operationProject, task?.sessionId, task?.stateAvailable]);

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
  const operationIcon = { collect: '采', knowledge: '知', content: '创', analyze: '析' }[operationTaskType];
  const operationStatusMeta = getOperationStatusMeta(task);
  const platformCode =
    operationConfig.channel ||
    operationConfig.publishChannel ||
    operationConfig.analysisChannel ||
    operationConfig.platformName ||
    task?.platformName;
  const platformNameMap: Record<string, string> = {
    WeChatAccount: '微信公众号',
    Xiaohongshu: '小红书',
    WeChatChannels: '微信视频号',
    Douyin: '抖音',
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
  const weekdayLabels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const formatWeekdays = (value: unknown) =>
    Array.isArray(value)
      ? value.map((weekday) => weekdayLabels[Number(weekday) - 1] || `${weekday}`).join('、')
      : value;
  const sourceModeLabelMap: Record<string, string> = {
    knowledge: '知识库采集',
    connector: '连接器采集',
    internet: '互联网采集',
  };
  const storageModeLabelMap: Record<string, string> = {
    ontology: '本体',
    knowledge: '知识库',
  };
  const executorTypeLabelMap: Record<string, string> = { agent: '数字员工', group: '员工组' };
  const runModeLabelMap: Record<string, string> = {
    once: '单次执行',
    periodic: '按周期执行',
    period: '按周期执行',
    interval: '按间隔执行',
  };
  const periodTypeLabelMap: Record<string, string> = {
    daily: '每天',
    weekly: '每周',
    biweekly: '每双周',
    monthly: '每月',
    yearly: '每年',
  };
  // 任务基础字段与任务模板结构化字段统一展开；只显示有值项，兼容历史字段别名。
  // 抽屉关闭时父组件会先清空 task，字段计算必须兼容这个短暂的空值状态。
  const operationDetailFields = [
    { label: '负责成员', value: task?.assigneeName || task?.assignee },
    {
      label: '完成时间',
      value:
        task?.dueTime && dayjs(task.dueTime).isValid() ? dayjs(task.dueTime).format('YYYY-MM-DD') : task?.dueTime,
    },
    {
      label: '创建时间',
      value:
        task?.createTime && dayjs(task.createTime).isValid()
          ? dayjs(task.createTime).format('YYYY-MM-DD HH:mm')
          : task?.createTime,
    },
    { label: '任务模板', value: operationConfig.templateName || task?.templateName },
    { label: '素材来源', value: operationConfig.materialSource },
    {
      label: '来源本体',
      value: operationConfig.sourceOntologyName || operationConfig.sourceOntology || operationConfig.sourceModeName,
    },
    {
      label: '采集方式',
      value: sourceModeLabelMap[operationConfig.sourceMode] || operationConfig.collectMethod || operationConfig.sourceMode,
    },
    { label: '来源知识库', value: operationConfig.sourceKnowledgeName || operationConfig.sourceKnowledge },
    { label: '连接器', value: operationConfig.connectorName || operationConfig.connector },
    { label: '互联网范围', value: operationConfig.internetScope },
    {
      label: '入库方式',
      value: storageModeLabelMap[operationConfig.storageMode] || operationConfig.storageMode,
    },
    {
      label: '目标本体',
      value: operationConfig.targetOntologyName || operationConfig.ontology || operationConfig.storageOntology,
    },
    { label: '目标知识库', value: operationConfig.targetKnowledgeName || operationConfig.targetKnowledge },
    { label: '内容类型', value: operationConfig.contentType },
    { label: '目标受众', value: operationConfig.audience },
    {
      label: '发布平台',
      value: operationTaskType === 'content' ? operationConfig.platform || operationPlatform : undefined,
    },
    { label: '发布账号', value: operationTaskType === 'content' ? operationAccount : undefined },
    { label: '发布安排', value: operationConfig.publishSchedule },
    { label: '分析范围', value: operationConfig.analysisScope || operationConfig.scope },
    { label: '时间范围', value: operationConfig.range },
    {
      label: '执行主体',
      value: executorTypeLabelMap[operationConfig.executorType] || operationConfig.executorType,
    },
    {
      label: '数字员工',
      value:
        task?.agentName ||
        operationConfig.agentName ||
        operationConfig.executorAgentName ||
        operationConfig.agentId,
    },
    { label: '员工组', value: operationConfig.agentGroupName || operationConfig.agentGroupId },
    { label: '执行方式', value: runModeLabelMap[operationConfig.runMode] || operationConfig.runMode },
    { label: '执行时间', value: operationConfig.onceTime },
    { label: '周期类型', value: periodTypeLabelMap[operationConfig.periodType] || operationConfig.periodType },
    { label: '执行时分', value: operationConfig.periodTime },
    { label: '执行日', value: formatWeekdays(operationConfig.periodWeekdays) },
    { label: '执行日期', value: operationConfig.periodMonthDays },
    { label: '年度执行时间', value: operationConfig.periodYearDateTime },
    { label: '间隔小时', value: operationConfig.intervalHours },
    { label: '间隔执行日', value: formatWeekdays(operationConfig.intervalWeekdays) },
    { label: '生效日期区间', value: operationConfig.effectiveDateRange },
    // 历史任务只有拼接后的调度文案时继续展示，避免执行配置完全缺失。
    {
      label: '执行安排',
      value:
        !operationConfig.publishSchedule && !operationConfig.collectSchedule && operationSchedule !== '-'
          ? operationSchedule
          : undefined,
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
          {operationProject ? (
            <div className={styles.operationTaskDetailContent}>
              <div className={styles.operationTaskSummary}>
                <span className={styles.operationTaskSummaryIcon}>{operationIcon}</span>
                <div className={styles.operationTaskSummaryMain}>
                  <small>
                    {[operationTaskTypeLabel, operationPlatform].filter(Boolean).join(' · ')}
                  </small>
                  <strong>{task.title || task.taskName || t('projectTaskDetail.defaultTaskName')}</strong>
                  <p>{task.description || task.taskDescription || '-'}</p>
                </div>
                <Tag color={operationStatusMeta.color} className={styles.operationTaskStatusTag}>
                  {operationStatusMeta.label}
                </Tag>
              </div>

              <section className={styles.operationTaskConfiguration}>
                <h3>{t('projectSpace.operation.task.detail.configuration')}</h3>
                <dl>
                  {operationDetailFields.map((field) => (
                    <div key={field.label}>
                      <dt>{field.label}</dt>
                      <dd>{formatDetailValue(field.value)}</dd>
                    </div>
                  ))}
                </dl>
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
