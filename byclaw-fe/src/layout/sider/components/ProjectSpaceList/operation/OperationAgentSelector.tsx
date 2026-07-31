import React, { useCallback, useMemo } from 'react';
import { Select } from 'antd';
import { useIntl } from '@umijs/max';
import type { OperationAgentOption, OperationAgentSelection, OperationIdentifier } from './types';
import styles from './index.module.less';

// 将总控数字员工和多个执行数字员工封装成一个受控表单字段，确保两类选择始终同步提交。
export interface OperationAgentSelectorProps {
  value?: OperationAgentSelection;
  agents?: OperationAgentOption[];
  loading?: boolean;
  disabled?: boolean;
  onChange?: (value: OperationAgentSelection) => void;
}

const OperationAgentSelector: React.FC<OperationAgentSelectorProps> = ({
  value,
  agents = [],
  loading = false,
  disabled = false,
  onChange,
}) => {
  const intl = useIntl();
  const t = useCallback((id: string) => intl.formatMessage({ id: `projectSpace.operation.agent.${id}` }), [intl]);
  const selection = value || {};
  // 将搜索关键词透传给 Select，支持按数字员工名称和补充关键字检索。
  const agentOptions = useMemo(
    () =>
      agents.map((agent) => ({
        label: agent.label,
        value: agent.value,
        disabled: agent.disabled,
        keywords: `${agent.label} ${agent.keywords || ''}`.trim(),
      })),
    [agents]
  );

  const emitChange = useCallback(
    (nextValue: Partial<OperationAgentSelection>) => {
      // 每次只更新一个选择项，同时保留另一项，避免 Antd 表单覆盖嵌套对象的已有值。
      onChange?.({
        controllerAgentId: selection.controllerAgentId,
        executorAgentIds: selection.executorAgentIds || [],
        ...nextValue,
      });
    },
    [onChange, selection.controllerAgentId, selection.executorAgentIds]
  );

  return (
    <div className={styles.agentSelector}>
      <div className={styles.agentSelectorField}>
        <label className={styles.operationFieldLabel}>
          {t('controller')}
          <span className={styles.operationRequiredMark}>*</span>
        </label>
        <Select<OperationIdentifier>
          value={selection.controllerAgentId}
          options={agentOptions}
          loading={loading}
          disabled={disabled}
          showSearch
          allowClear
          optionFilterProp="keywords"
          placeholder={t('controllerPlaceholder')}
          notFoundContent={t('empty')}
          onChange={(controllerAgentId) => emitChange({ controllerAgentId })}
        />
        <span className={styles.operationFieldHint}>{t('controllerHint')}</span>
      </div>
      <div className={styles.agentSelectorField}>
        <label className={styles.operationFieldLabel}>
          {t('executors')}
          <span className={styles.operationRequiredMark}>*</span>
        </label>
        <Select<OperationIdentifier[]>
          mode="multiple"
          value={selection.executorAgentIds || []}
          options={agentOptions}
          loading={loading}
          disabled={disabled}
          showSearch
          allowClear
          maxTagCount="responsive"
          optionFilterProp="keywords"
          placeholder={t('executorsPlaceholder')}
          notFoundContent={t('empty')}
          onChange={(executorAgentIds) => emitChange({ executorAgentIds })}
        />
        <span className={styles.operationFieldHint}>{t('executorsHint')}</span>
      </div>
    </div>
  );
};

export default OperationAgentSelector;
