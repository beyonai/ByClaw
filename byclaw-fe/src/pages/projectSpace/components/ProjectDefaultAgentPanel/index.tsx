import React, { useEffect, useMemo, useState } from 'react';
import { Button, Empty, Modal, Select, message } from 'antd';
import { CommentOutlined, DeleteOutlined, SwapOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import { getDefaultAgent, saveDefaultAgent, type DefaultAgentConfig } from '@/service/devloop';
import { getAgentChatAvatar } from '@/utils/agent';
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

/** 「去聊天」带给输入框的员工信息:光有 agentId 不够,见下方 onChatWithAgent 注释。 */
export type ChatWithAgentTarget = {
  agentId: string;
  name?: string;
  chatAvatar?: string;
  agentType?: string;
};

interface Props {
  projectId: number;
  active: boolean;
  // 带员工进新会话:与工具栏「新建会话」同一入口,额外把该员工设为会话 agent,输入框据此预置 @。
  // 必须连名字/头像/类型一起给:输入框的 useDefaultAgentElement 只拿 agentId 去 redux 的 employees
  // 列表里查,而这些员工来自 useDigitalEmployeeOptions 自己拉的两个接口、不在那份列表里,查不到就会
  // 兜底成「AI 助手」——@ 出来的就不是用户点的那个人了。
  onChatWithAgent?: (target: ChatWithAgentTarget) => void;
}

// 角色卡不是资源实体,只借 ResourceCard 的壳:
// - 不给 resourceId,ResourceCard 的权限查询会整段跳过,角色卡不打无效请求;
// - 菜单走 actionConfig.extraMenuItems(不过权限校验),这样右下角三个点才会出现 ——
//   ResourceCard 仅在菜单非空时渲染那个按钮。
const roleCardResource = (roleLabel: string, agentName?: string): IResourceCardItem => ({
  resourceName: agentName || '',
  tagName: roleLabel,
});

// 项目详情「数字员工」tab:维护该项目四角色(架构/需求/研发/测试)的兜底助理覆盖。
// 未为某角色指定=占位提示全局默认,回退到全局(合并在后端 resolve 完成);保存写项目作用域覆盖。
const ProjectDefaultAgentPanel: React.FC<Props> = ({ projectId, active, onChatWithAgent }) => {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { options, loading } = useDigitalEmployeeOptions(active);
  const [draft, setDraft] = useState<DefaultAgentAssignment>(emptyAssignment());
  const [globalDefaults, setGlobalDefaults] = useState<DefaultAgentConfig>({});

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
            <span className={styles.roleOptionLogo}>{getAgentChatAvatar(option.chatAvatar)}</span>
            <span className={styles.roleOptionLabel}>{option.label}</span>
          </span>
        ),
      })),
    [options]
  );
  const labelById = useMemo(() => new Map(options.map((option) => [option.value, option.label])), [options]);
  const avatarById = useMemo(
    () =>
      new Map(
        options.filter((option) => option.chatAvatar).map((option) => [option.value, option.chatAvatar as string])
      ),
    [options]
  );
  const agentTypeById = useMemo(
    () =>
      new Map(options.filter((option) => option.agentType).map((option) => [option.value, option.agentType as string])),
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

  // 当前对该角色真正生效的员工:项目覆盖优先,未指定则是全局默认那位。
  // 标题、头像、「去聊天」都以它为准,三处保持同一个人。
  const effectiveAgentIdOf = (role: DefaultAgentRole) => draft[role] || globalDefaults[`${role}AgentId`] || '';

  // 改完即落库:取消底部保存按钮后,更换/清除各自是一次完整提交。
  // 失败回滚到提交前的草稿,避免界面显示未真正保存的值。
  const persistAssignment = async (next: DefaultAgentAssignment, previous: DefaultAgentAssignment) => {
    setDraft(next);
    try {
      await saveDefaultAgent(assignmentToPayload(next, labelById, projectId));
      message.success(t('projectSpace.defaultAgent.saveSuccess'));
    } catch (error: any) {
      setDraft(previous);
      message.error(error?.message || t('projectSpace.defaultAgent.saveFailed'));
    }
  };

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
    closeRoleEditor();
    void persistAssignment({ ...draft, [editingRole]: editingValue || '' }, draft);
  };

  // 清除只回到「沿用全局默认」,不是删配置;与更换一样即时落库。
  const clearRole = (role: DefaultAgentRole) => {
    void persistAssignment({ ...draft, [role]: '' }, draft);
  };

  // 卡片标题:优先本项目已选员工名(选项表里查,退 id),未指定则显示全局默认提示。
  const agentNameOf = (role: DefaultAgentRole) => {
    const picked = draft[role];
    return picked ? labelById.get(picked) || picked : globalPlaceholder(role);
  };

  // 头像走 chatAvatar + getAgentChatAvatar,与「数字员工」页两个 Tab 同一条管道:
  // 圆形、支持 icon- 字体图标、加载失败回落默认头像。
  const agentAvatarOf = (role: DefaultAgentRole) => {
    const effectiveId = effectiveAgentIdOf(role);
    return effectiveId ? avatarById.get(effectiveId) : undefined;
  };

  // 「去聊天」的目标:名字优先选项表,退全局默认那份冗余名,再退 id —— 名字是 @ 出来显示的文本,
  // 空字符串会让 mention 退化成显示 agentId,所以一路兜到底。
  const chatTargetOf = (role: DefaultAgentRole): ChatWithAgentTarget => {
    const agentId = effectiveAgentIdOf(role);
    return {
      agentId,
      name: labelById.get(agentId) || globalDefaults[`${role}AgentName`] || agentId,
      chatAvatar: avatarById.get(agentId),
      agentType: agentTypeById.get(agentId),
    };
  };

  return (
    <div className={styles.panel}>
      <div className={styles.scroll}>
        <p className={styles.hint}>{t('projectSpace.defaultAgent.projectHint')}</p>
        <div className={styles.roleGrid}>
          {DEFAULT_AGENT_ROLES.map((role) => (
            <ResourceCard
              key={role}
              resource={roleCardResource(t(`projectSpace.projectForm.defaultAgent.role.${role}`), agentNameOf(role))}
              description={t(`projectSpace.defaultAgent.roleDesc.${role}`)}
              avatarNode={<div className={styles.roleAvatar}>{getAgentChatAvatar(agentAvatarOf(role))}</div>}
              // 走 metaNode 顶掉创建者那一格(角色卡没有创建者可言),而不是 hoverExtra:
              // hoverExtra 靠右贴边,会和 ResourceCard 绝对定位在右下角的三个点按钮叠在一起。
              metaNode={
                onChatWithAgent && effectiveAgentIdOf(role) ? (
                  <Button
                    type="link"
                    size="small"
                    icon={<CommentOutlined />}
                    className={styles.roleChatButton}
                    onClick={() => onChatWithAgent(chatTargetOf(role))}
                  >
                    {t('projectSpace.defaultAgent.chatWithAgent')}
                  </Button>
                ) : undefined
              }
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
