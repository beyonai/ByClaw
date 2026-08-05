import React, { useEffect, useMemo, useState } from 'react';
import { Button, Empty, Select, message } from 'antd';
import { RobotOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import { getDefaultAgent, saveDefaultAgent, type DefaultAgentConfig } from '@/service/devloop';
import { useDigitalEmployeeOptions } from '../../hooks/useDigitalEmployeeOptions';
import {
  DEFAULT_AGENT_ROLES,
  DEFAULT_AGENT_ROLE_MESSAGE_ID,
  assignmentToPayload,
  configToAssignment,
  emptyAssignment,
  type DefaultAgentAssignment,
  type DefaultAgentRole,
} from '../../defaultAgents';
import styles from './index.module.less';

interface Props {
  projectId: number;
  active: boolean;
}

// 项目详情「数字员工」tab:维护该项目三角色(架构/代码/测试)的兜底员工覆盖。
// 未为某角色指定=占位提示全局默认,回退到全局(合并在后端 resolve 完成);保存写项目作用域覆盖。
const ProjectDefaultAgentPanel: React.FC<Props> = ({ projectId, active }) => {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { options, loading } = useDigitalEmployeeOptions(active);
  const [draft, setDraft] = useState<DefaultAgentAssignment>(emptyAssignment());
  const [globalDefaults, setGlobalDefaults] = useState<DefaultAgentConfig>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!active || !projectId) return;
    let cancelled = false;
    // 并行拉全局默认(占位提示用)与本项目覆盖(回填草稿)。
    Promise.all([getDefaultAgent(), getDefaultAgent(projectId)])
      .then(([global, project]) => {
        if (cancelled) return;
        setGlobalDefaults(global || {});
        setDraft(configToAssignment(project));
      })
      .catch(() => {
        if (!cancelled) {
          setGlobalDefaults({});
          setDraft(emptyAssignment());
        }
      });
    return () => {
      cancelled = true;
    };
  }, [active, projectId]);

  const selectOptions = useMemo(
    () => options.map((option) => ({ value: option.value, label: option.label })),
    [options]
  );
  const labelById = useMemo(() => new Map(options.map((option) => [option.value, option.label])), [options]);

  // 未指定项目覆盖时占位提示全局默认员工(优先冗余名,退 id;无则提示未配置)。
  const globalPlaceholder = (role: DefaultAgentRole) => {
    const name = globalDefaults[`${role}AgentName`] || globalDefaults[`${role}AgentId`];
    return name
      ? t('projectSpace.projectForm.defaultAgent.globalPrefix') + name
      : t('projectSpace.projectForm.defaultAgent.globalUnset');
  };

  const handleSelect = (role: DefaultAgentRole, value?: string) => {
    setDraft((prev) => ({ ...prev, [role]: value || '' }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveDefaultAgent(assignmentToPayload(draft, labelById, projectId));
      message.success(t('projectSpace.defaultAgent.saveSuccess'));
    } catch (error: any) {
      message.error(error?.message || t('projectSpace.defaultAgent.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.panel}>
      <div className={styles.scroll}>
        <p className={styles.hint}>{t('projectSpace.defaultAgent.projectHint')}</p>
        {DEFAULT_AGENT_ROLES.map((role) => (
          <div className={styles.roleCard} key={role}>
            <div className={styles.roleHeader}>
              <span className={styles.roleIcon}>
                <RobotOutlined />
              </span>
              <span className={styles.roleName}>{t(DEFAULT_AGENT_ROLE_MESSAGE_ID[role])}</span>
            </div>
            <Select
              className={styles.roleSelect}
              value={draft[role] || undefined}
              options={selectOptions}
              loading={loading}
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder={globalPlaceholder(role)}
              onChange={(value?: string) => handleSelect(role, value)}
              notFoundContent={
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('projectSpace.defaultAgent.noAgent')} />
              }
            />
          </div>
        ))}
      </div>
      <div className={styles.footer}>
        <Button className={styles.saveButton} type="primary" loading={saving} onClick={handleSave}>
          {t('projectSpace.defaultAgent.save')}
        </Button>
      </div>
    </div>
  );
};

export default ProjectDefaultAgentPanel;
