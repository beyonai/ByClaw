import React, { useEffect, useMemo, useState } from 'react';
import { Button, Empty, Modal, Select, message } from 'antd';
import { DeleteOutlined, SwapOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import { getDefaultAgent, saveDefaultAgent, type DefaultAgentConfig } from '@/service/devloop';
import { getFileUrl } from '@/utils/file';
import ResourceCard, { type IResourceCardItem } from '@/components/Resources/components/ResourceCard';
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

// 角色卡不是资源实体,只借 ResourceCard 的壳:
// - 不给 resourceId,ResourceCard 的权限查询会整段跳过,角色卡不打无效请求;
// - 菜单走 actionConfig.extraMenuItems(不过权限校验),这样右下角三个点才会出现 ——
//   ResourceCard 仅在菜单非空时渲染那个按钮;
// - 头像给 resourceLogoUrl 原始路径,由 ResourceCard 自己 getFileUrl 并处理加载失败,
//   不传 avatarNode(那会顶掉它的图片分支)。
const roleCardResource = (roleLabel: string, agentName?: string, logo?: string): IResourceCardItem => ({
  resourceName: agentName || '',
  tagName: roleLabel,
  resourceLogoUrl: logo,
});

// 项目详情「数字员工」tab:维护该项目四角色(架构/需求/研发/测试)的兜底助理覆盖。
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

  // 下拉项也带头像:选人时按图标认比纯文字快。label 是节点,搜索另给 optionFilterProp 用的纯文本。
  const selectOptions = useMemo(
    () =>
      options.map((option) => ({
        value: option.value,
        title: option.label,
        label: (
          <span className={styles.roleOption}>
            {option.logo ? (
              <img className={styles.roleOptionLogo} src={getFileUrl(option.logo)} alt="" />
            ) : (
              <span className={styles.roleOptionLogoFallback}>{option.label.slice(0, 1)}</span>
            )}
            <span className={styles.roleOptionLabel}>{option.label}</span>
          </span>
        ),
      })),
    [options]
  );
  const labelById = useMemo(() => new Map(options.map((option) => [option.value, option.label])), [options]);
  const logoById = useMemo(
    () => new Map(options.filter((option) => option.logo).map((option) => [option.value, option.logo as string])),
    [options]
  );

  // 未指定项目覆盖时占位提示全局默认员工(优先冗余名,退 id;无则提示未配置)。
  const globalPlaceholder = (role: DefaultAgentRole) => {
    const name = globalDefaults[`${role}AgentName`] || globalDefaults[`${role}AgentId`];
    return name
      ? t('projectSpace.projectForm.defaultAgent.globalPrefix') + name
      : t('projectSpace.projectForm.defaultAgent.globalUnset');
  };

  // 卡内没有下拉位:选员工走「三个点 → 更换」再开小窗,editingRole 非空即为窗打开。
  const [editingRole, setEditingRole] = useState<DefaultAgentRole | null>(null);
  const [editingValue, setEditingValue] = useState<string | undefined>(undefined);

  const openRoleEditor = (role: DefaultAgentRole) => {
    setEditingRole(role);
    setEditingValue(draft[role] || undefined);
  };

  const closeRoleEditor = () => {
    setEditingRole(null);
    setEditingValue(undefined);
  };

  const confirmRoleEditor = () => {
    if (!editingRole) return;
    setDraft((prev) => ({ ...prev, [editingRole]: editingValue || '' }));
    closeRoleEditor();
  };

  // 清除只回到「沿用全局默认」,不是删配置;仍需点保存才落库,与更换保持一致。
  const clearRole = (role: DefaultAgentRole) => {
    setDraft((prev) => ({ ...prev, [role]: '' }));
  };

  // 卡片标题:优先本项目已选员工名(选项表里查,退 id),未指定则显示全局默认提示。
  const agentNameOf = (role: DefaultAgentRole) => {
    const picked = draft[role];
    return picked ? labelById.get(picked) || picked : globalPlaceholder(role);
  };

  // 头像跟着「当前生效的那个员工」走:项目覆盖优先,未指定则用全局默认那位的头像,
  // 与标题展示的员工保持一致;拿不到头像时 ResourceCard 自己回落默认图标。
  const agentLogoOf = (role: DefaultAgentRole) => {
    const effectiveId = draft[role] || globalDefaults[`${role}AgentId`] || '';
    return effectiveId ? logoById.get(effectiveId) : undefined;
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
        <div className={styles.roleGrid}>
          {DEFAULT_AGENT_ROLES.map((role) => (
            <ResourceCard
              key={role}
              resource={roleCardResource(
                t(`projectSpace.projectForm.defaultAgent.role.${role}`),
                agentNameOf(role),
                agentLogoOf(role)
              )}
              description={t(`projectSpace.defaultAgent.roleDesc.${role}`)}
              actionConfig={{
                extraMenuItems: [
                  {
                    key: 'change',
                    label: (
                      <span className={styles.roleMenuItem}>
                        <SwapOutlined />
                        {t('projectSpace.defaultAgent.changeAgent')}
                      </span>
                    ),
                    onClick: () => openRoleEditor(role),
                  },
                  {
                    key: 'clear',
                    label: (
                      <span className={styles.roleMenuItem}>
                        <DeleteOutlined />
                        {t('projectSpace.defaultAgent.clearAgent')}
                      </span>
                    ),
                    // 没指定过就没什么可清除,菜单里不出这一项。
                    visible: () => Boolean(draft[role]),
                    onClick: () => clearRole(role),
                  },
                ],
              }}
            />
          ))}
        </div>
      </div>
      <div className={styles.footer}>
        <Button className={styles.saveButton} size="small" type="primary" loading={saving} onClick={handleSave}>
          {t('projectSpace.defaultAgent.save')}
        </Button>
      </div>
      <Modal
        open={Boolean(editingRole)}
        title={editingRole ? t(DEFAULT_AGENT_ROLE_MESSAGE_ID[editingRole]) : undefined}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
        onOk={confirmRoleEditor}
        onCancel={closeRoleEditor}
      >
        <Select
          className={styles.roleSelect}
          value={editingValue}
          options={selectOptions}
          loading={loading}
          allowClear
          showSearch
          // label 是带头像的节点,搜索要落到纯文本 title 上,否则匹配不到。
          optionFilterProp="title"
          placeholder={editingRole ? globalPlaceholder(editingRole) : undefined}
          onChange={(value?: string) => setEditingValue(value)}
          notFoundContent={
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('projectSpace.defaultAgent.noAgent')} />
          }
        />
      </Modal>
    </div>
  );
};

export default ProjectDefaultAgentPanel;
