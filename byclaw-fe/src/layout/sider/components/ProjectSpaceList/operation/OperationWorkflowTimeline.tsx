import React, { useCallback } from 'react';
import { Empty, Spin } from 'antd';
import {
  CheckCircleFilled,
  ClockCircleOutlined,
  CloseCircleFilled,
  ExclamationCircleOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import type { OperationWorkflowStatus, OperationWorkflowStep } from './types';
import styles from './index.module.less';

// 工作流时间轴既用于任务详情，也可作为独立区域嵌入；步骤数据由任务详情接口提供。
export interface OperationWorkflowTimelineProps {
  steps?: OperationWorkflowStep[];
  loading?: boolean;
  showTitle?: boolean;
}

// 状态图标与颜色类分离维护，新增状态时可确保图标和视觉状态同时补齐。
const STATUS_ICON: Record<OperationWorkflowStatus, React.ReactNode> = {
  pending: <ClockCircleOutlined />,
  in_progress: <SyncOutlined spin />,
  waiting_confirmation: <ExclamationCircleOutlined />,
  completed: <CheckCircleFilled />,
  failed: <CloseCircleFilled />,
};

const STATUS_CLASS: Record<OperationWorkflowStatus, string> = {
  pending: styles.workflowStepPending,
  in_progress: styles.workflowStepInProgress,
  waiting_confirmation: styles.workflowStepWaiting,
  completed: styles.workflowStepCompleted,
  failed: styles.workflowStepFailed,
};

const OperationWorkflowTimeline: React.FC<OperationWorkflowTimelineProps> = ({
  steps = [],
  loading = false,
  showTitle = true,
}) => {
  const intl = useIntl();
  const t = useCallback((id: string) => intl.formatMessage({ id: `projectSpace.operation.workflow.${id}` }), [intl]);

  return (
    <section className={styles.workflowPanel}>
      {showTitle && <h3 className={styles.workflowTitle}>{t('title')}</h3>}
      <Spin spinning={loading}>
        {steps.length === 0 ? (
          <div className={styles.workflowEmpty}>
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('empty')} />
          </div>
        ) : (
          <div className={styles.workflowList}>
            {steps.map((step, index) => (
              <article key={String(step.id)} className={`${styles.workflowStep} ${STATUS_CLASS[step.status]}`}>
                <div className={styles.workflowStepRail}>
                  <span className={styles.workflowStepIcon}>{STATUS_ICON[step.status]}</span>
                  {index < steps.length - 1 && <span className={styles.workflowStepLine} />}
                </div>
                <div className={styles.workflowStepBody}>
                  <div className={styles.workflowStepHeader}>
                    <strong>{step.name}</strong>
                    <span>{t(`status.${step.status}`)}</span>
                  </div>
                  {step.agentName && (
                    <div className={styles.workflowStepAgent}>
                      <span>{t('agent')}</span>
                      <strong>{step.agentName}</strong>
                    </div>
                  )}
                  {step.summary && <p className={styles.workflowStepSummary}>{step.summary}</p>}
                  {(step.startedAt || step.completedAt) && (
                    <div className={styles.workflowStepTime}>
                      {step.startedAt && (
                        <span>
                          {t('startedAt')}: {step.startedAt}
                        </span>
                      )}
                      {step.completedAt && (
                        <span>
                          {t('completedAt')}: {step.completedAt}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </Spin>
    </section>
  );
};

export default OperationWorkflowTimeline;
