import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { Button, Form, Input, Modal, Select, Spin, Switch, Tooltip, message } from 'antd';
import type { FormInstance } from 'antd';
import { CloseCircleFilled, PlusOutlined } from '@ant-design/icons';
import { useIntl, useSelector } from '@umijs/max';
import AddAuthModal from '@/pages/manager/components/AuthListDrawer/AddAuthModal';
import { listProjectMembers } from '@/service/devloop';
import { DEFAULT_PROJECT_TYPE_OPTION, PROJECT_TYPE_OPTIONS } from '../../constants';
import type { ProjectTypeOption } from '../../hooks/useProjectTypeConfig';
import type { ProjectSpace } from '../../types';
import { getDefaultAgent, type DefaultAgentConfig } from '@/service/devloop';
import { useDigitalEmployeeOptions } from '../../hooks/useDigitalEmployeeOptions';
import {
  DEFAULT_AGENT_ROLES,
  assignmentToPayload,
  configToAssignment,
  emptyAssignment,
  type DefaultAgentAssignment,
  type DefaultAgentRole,
} from '../../defaultAgents';
import styles from './index.module.less';

export interface ProjectShareMember {
  id: string;
  type: 'USER';
  userId: string | number;
  userCode?: string;
  userName: string;
  name: string;
  memberId?: string | number;
  role?: string;
  cannotDel?: boolean;
}

export interface ProjectFormValues {
  projectName: string;
  description?: string;
  projectType: ProjectSpace['projectType'];
  sharedFlag: boolean;
  shareMembers?: ProjectShareMember[];
  shareMembersLoaded?: boolean;
  // 每项目默认数字员工覆盖(架构/代码/测试)已解析为后端保存入参;空值角色代表沿用全局默认。
  defaultAgents?: DefaultAgentConfig;
}

// 供父级(单表单弹窗 / 新建向导 step1)命令式取值:校验通过返回合并后的完整表单值,失败返回 null。
export interface ProjectBasicFormHandle {
  collectValues: () => Promise<ProjectFormValues | null>;
}

interface Props {
  open: boolean;
  form: FormInstance<ProjectFormValues>;
  initialValues?: Partial<ProjectFormValues>;
  projectId?: string | number;
  creatorId?: string | number;
  projectTypeConfigOptions?: ProjectTypeOption[];
  projectTypeLoading?: boolean;
  // 单行输入框回车触发父级提交(单表单弹窗保留该交互;向导可不传)。
  onEnterSubmit?: () => void;
}

const getMemberUserId = (member: any) => member.userId ?? String(member.id || '').replace(/^user_/, '');

const isProjectOwnerMember = (member: any, creatorId?: string | number) => {
  // 新老数据都兼容：新数据有 owner role，老数据用项目创建人 ID 兜底。
  const isOwnerRole = ['owner', 'creator'].includes(`${member?.role || ''}`.toLowerCase());
  return isOwnerRole || (!!creatorId && `${getMemberUserId(member)}` === `${creatorId}`);
};

const normalizeShareMember = (member: any): ProjectShareMember => {
  const userId = getMemberUserId(member);
  const userName = member.userName || member.name || member.targetName || `${userId || ''}`;
  return {
    ...member,
    id: member.id || `user_${userId}`,
    type: 'USER',
    userId,
    userCode: member.userCode,
    userName,
    name: userName,
    memberId: member.memberId,
    role: member.role,
  };
};

const ProjectBasicForm = forwardRef<ProjectBasicFormHandle, Props>(
  (
    { open, form, initialValues, projectId, creatorId, projectTypeConfigOptions, projectTypeLoading, onEnterSubmit },
    ref
  ) => {
    const intl = useIntl();
    const userInfo = useSelector((state: any) => state.user?.userInfo) || {};
    const [authModalOpen, setAuthModalOpen] = useState(false);
    const [selectedShareMembers, setSelectedShareMembers] = useState<ProjectShareMember[]>([]);
    const [shareMembersLoading, setShareMembersLoading] = useState(false);
    const [shareMembersLoaded, setShareMembersLoaded] = useState(false);
    // 每项目默认数字员工覆盖:弹窗打开时加载可选员工 + 该项目已存覆盖 + 全局默认(placeholder 提示)。
    const [projectDefaultAgents, setProjectDefaultAgentsDraft] = useState<DefaultAgentAssignment>(emptyAssignment());
    const [globalDefaultAgents, setGlobalDefaultAgents] = useState<DefaultAgentConfig>({});
    const { options: agentOptions, loading: agentOptionsLoading } = useDigitalEmployeeOptions(open);
    const currentUserId = userInfo.userId ?? userInfo.id;
    const currentUserCode = userInfo.userCode;
    const currentUserName = userInfo.userName || userInfo.userNickName || userInfo.nickName || currentUserCode;
    const formT = useCallback((id: string) => intl.formatMessage({ id: `projectSpace.projectForm.${id}` }), [intl]);
    const memberT = useCallback((id: string) => intl.formatMessage({ id: `projectSpace.members.${id}` }), [intl]);
    const configuredProjectTypeOptions = projectTypeConfigOptions?.length
      ? projectTypeConfigOptions
      : PROJECT_TYPE_OPTIONS;
    const localizedProjectTypeLabels = useMemo(
      () => ({
        normal: formT('type.normal'),
        operation: formT('type.operation'),
        develop: formT('type.develop'),
        default: formT('type.default'),
      }),
      [formT]
    );
    const localizedProjectTypeOptions = useMemo(
      () =>
        configuredProjectTypeOptions.map((option) => ({
          ...option,
          label: localizedProjectTypeLabels[option.value] || option.label,
        })),
      [configuredProjectTypeOptions, localizedProjectTypeLabels]
    );
    const isDevelopProjectEnabled = configuredProjectTypeOptions.some((option) => option.value === 'develop');
    const projectType = Form.useWatch('projectType', form);
    const sharedFlag = Form.useWatch('sharedFlag', form);
    const isDevelopProject = isDevelopProjectEnabled && projectType === 'develop';
    const isOperationProject = projectType === 'operation';
    const isForcedSharedProject = isDevelopProject || isOperationProject;
    const formInitialValues = useMemo(() => {
      const values = {
        projectName: '',
        description: '',
        projectType: 'normal' as ProjectSpace['projectType'],
        sharedFlag: false,
        shareMembers: [],
        ...initialValues,
      };
      if (values.projectType === 'default') {
        // 默认项目固定为不共享，编辑弹窗回显时也不使用接口里的共享值。
        values.sharedFlag = false;
      }
      return values;
    }, [initialValues]);
    const isEditingDefaultProject = !!projectId && formInitialValues.projectType === 'default';
    const isDefaultProject = projectType === 'default' || isEditingDefaultProject;
    // 研发项目与运营项目一样强制共享,共享成员区块照常显示可配置(仅开关锁死为开)。
    const isProjectShared = !isDefaultProject && (isForcedSharedProject || !!sharedFlag);
    const normalizeProjectShareMember = useCallback(
      (member: any): ProjectShareMember => {
        const normalizedMember = normalizeShareMember(member);
        // 已落库项目的创建者在授权弹窗右侧不展示删除入口，避免用户误以为可以移除。
        return isProjectOwnerMember(normalizedMember, creatorId)
          ? { ...normalizedMember, cannotDel: true }
          : normalizedMember;
      },
      [creatorId]
    );
    const visibleProjectTypeOptions = useMemo(() => {
      const selectableOptions = localizedProjectTypeOptions.filter((option) => option.value !== 'default');

      // 默认项目只用于编辑默认项目时回显，不放入新建项目和普通项目编辑的下拉选项。
      if (formInitialValues.projectType === 'default') {
        const defaultOption = localizedProjectTypeOptions.find((option) => option.value === 'default') || {
          ...DEFAULT_PROJECT_TYPE_OPTION,
          label: localizedProjectTypeLabels.default,
        };
        return [defaultOption, ...selectableOptions];
      }

      if (!selectableOptions.some((option) => option.value === formInitialValues.projectType)) {
        // 历史业务项目在当前环境未配置对应类型时仅允许回显，避免 Select 出现空值。
        return [
          {
            label:
              localizedProjectTypeLabels[formInitialValues.projectType] ||
              localizedProjectTypeOptions.find((option) => option.value === formInitialValues.projectType)?.label ||
              formInitialValues.projectType,
            value: formInitialValues.projectType,
            disabled: true,
          },
          ...selectableOptions,
        ];
      }

      return selectableOptions;
    }, [formInitialValues.projectType, localizedProjectTypeLabels, localizedProjectTypeOptions]);

    useEffect(() => {
      if (!open) return;
      // Antd Form 的 initialValues 只在首次挂载生效，每次打开弹窗时主动重置，避免新建项目带出上次旧值。
      form.resetFields();
      form.setFieldsValue(formInitialValues);
      setSelectedShareMembers((formInitialValues.shareMembers || []).map(normalizeProjectShareMember));
      setShareMembersLoaded(!projectId);
    }, [form, formInitialValues, normalizeProjectShareMember, open, projectId]);

    useEffect(() => {
      if (!open) return;
      let cancelled = false;
      // 全局默认给 placeholder 用;编辑项目再拉该项目的覆盖行回显(新建项目无覆盖,留空即全部回退全局)。
      getDefaultAgent()
        .then((config) => {
          if (!cancelled) setGlobalDefaultAgents(config || {});
        })
        .catch(() => {
          if (!cancelled) setGlobalDefaultAgents({});
        });
      if (projectId) {
        getDefaultAgent(Number(projectId))
          .then((config) => {
            if (!cancelled) setProjectDefaultAgentsDraft(configToAssignment(config));
          })
          .catch(() => {
            if (!cancelled) setProjectDefaultAgentsDraft(emptyAssignment());
          });
      } else {
        setProjectDefaultAgentsDraft(emptyAssignment());
      }
      return () => {
        cancelled = true;
      };
    }, [open, projectId]);

    useEffect(() => {
      if (!open || projectId || !visibleProjectTypeOptions.length) return;
      // 新建项目始终采用当前下拉列表第一项，静态参数异步返回后也会同步更新默认值。
      form.setFieldValue('projectType', visibleProjectTypeOptions[0].value);
    }, [form, open, projectId, visibleProjectTypeOptions]);

    useEffect(() => {
      if (!open || !projectId) return;

      setShareMembersLoading(true);
      setShareMembersLoaded(false);
      listProjectMembers(Number(projectId))
        .then((res) => {
          const memberList = Array.isArray(res) ? res : [];
          // 共享成员直接使用成员 tab 的同一份项目成员数据，避免共享配置和成员列表两套数据不一致。
          setSelectedShareMembers(memberList.map(normalizeProjectShareMember));
          setShareMembersLoaded(true);
        })
        .catch((error) => {
          console.error('Failed to load project members for share members:', error);
          message.error(memberT('loadFailed'));
        })
        .finally(() => {
          setShareMembersLoading(false);
        });
    }, [memberT, normalizeProjectShareMember, open, projectId]);

    useEffect(() => {
      if (!open || !isForcedSharedProject) return;
      // 研发项目和运营项目必须共享，切换类型时强制打开开关并保留已选成员。
      form.setFieldValue('sharedFlag', true);
    }, [form, isForcedSharedProject, open]);

    useEffect(() => {
      if (!open || !isDefaultProject) return;
      // 默认项目不参与共享成员维护，是否共享固定为否。
      form.setFieldValue('sharedFlag', false);
      form.setFields([{ name: 'shareMembers', errors: [] }]);
    }, [form, isDefaultProject, open]);

    useEffect(() => {
      if (!open || projectId || !isProjectShared || !currentUserId) return;

      setSelectedShareMembers((previousMembers) => {
        const currentUserIndex = previousMembers.findIndex(
          (member) =>
            `${getMemberUserId(member)}` === `${currentUserId}` ||
            (!!currentUserCode && `${member.userCode || ''}` === `${currentUserCode}`)
        );

        if (currentUserIndex >= 0) {
          // 新建项目尚未落库时没有 creatorId，给当前用户补 owner 身份以复用创建者禁删规则。
          return previousMembers.map((member, index) =>
            index === currentUserIndex && (!isProjectOwnerMember(member) || !member.cannotDel)
              ? { ...member, role: 'owner', cannotDel: true }
              : member
          );
        }

        // 打开共享后，项目创建者必须作为共享成员保留，提交后由后端以 owner 角色持久化。
        const ownerMember = normalizeShareMember({
          id: `user_${currentUserId}`,
          type: 'USER',
          userId: currentUserId,
          userCode: currentUserCode,
          userName: currentUserName || `${currentUserId}`,
          name: currentUserName || `${currentUserId}`,
          role: 'owner',
          cannotDel: true,
        });
        return [ownerMember, ...previousMembers];
      });
    }, [currentUserCode, currentUserId, currentUserName, isProjectShared, open, projectId]);

    const removeShareMember = (targetId: string) => {
      setSelectedShareMembers((prev) => prev.filter((target) => target.id !== targetId));
    };

    const isCurrentUserMember = (member: ProjectShareMember) => {
      return (
        (!!member.userId && `${member.userId}` === `${currentUserId || ''}`) ||
        (!!member.userCode && `${member.userCode}` === `${currentUserCode || ''}`)
      );
    };

    const isNewProjectOwnerMember = (member: ProjectShareMember) => !projectId && isCurrentUserMember(member);

    const isLockedShareMember = (member: ProjectShareMember) => {
      return isProjectOwnerMember(member, creatorId) || isNewProjectOwnerMember(member);
    };

    const handleRemoveShareTarget = (member: ProjectShareMember) => {
      if (isLockedShareMember(member)) {
        message.warning(memberT('creatorCannotRemove'));
        return;
      }

      if (isCurrentUserMember(member)) {
        Modal.confirm({
          title: memberT('removeSelf'),
          content: memberT('removeSelfConfirm'),
          okText: memberT('remove'),
          okButtonProps: { danger: true },
          onOk: () => removeShareMember(member.id),
        });
        return;
      }

      removeShareMember(member.id);
    };

    const agentSelectOptions = agentOptions.map((option) => ({ value: option.value, label: option.label }));
    const agentLabelById = new Map(agentOptions.map((option) => [option.value, option.label]));

    // 合并表单原始值与共享成员/默认员工副本,强制校正共享标记,产出后端保存入参。
    const buildSubmitValues = useCallback(
      (values: ProjectFormValues): ProjectFormValues => {
        const submitIsDevelopProject = isDevelopProjectEnabled && values.projectType === 'develop';
        const submitIsOperationProject = values.projectType === 'operation';
        const submitSharedFlag =
          values.projectType === 'default'
            ? false
            : submitIsDevelopProject || submitIsOperationProject || values.sharedFlag;
        return {
          ...values,
          sharedFlag: submitSharedFlag,
          shareMembers: submitSharedFlag ? selectedShareMembers : [],
          shareMembersLoaded,
          // 解析为后端入参并冗余带上员工名(展示列);projectId 由父级在保存时补上。
          defaultAgents: assignmentToPayload(projectDefaultAgents, agentLabelById),
        };
      },
      [agentLabelById, isDevelopProjectEnabled, projectDefaultAgents, selectedShareMembers, shareMembersLoaded]
    );

    useImperativeHandle(
      ref,
      () => ({
        collectValues: async () => {
          try {
            const values = await form.validateFields();
            return buildSubmitValues(values);
          } catch {
            // 校验失败:antd 已在字段下方标红,父级据 null 中止提交。
            return null;
          }
        },
      }),
      [buildSubmitValues, form]
    );

    // 未为该角色指定项目覆盖时,占位提示当前生效的全局默认员工(优先冗余名,退选项名,再退id;无则提示未配置)。
    const globalDefaultLabel = (role: DefaultAgentRole) => {
      const idKey = `${role}AgentId` as keyof DefaultAgentConfig;
      const nameKey = `${role}AgentName` as keyof DefaultAgentConfig;
      const globalId = (globalDefaultAgents[idKey] as string) || '';
      if (!globalId) return formT('defaultAgent.globalUnset');
      const name = (globalDefaultAgents[nameKey] as string) || agentLabelById.get(globalId) || globalId;
      return formT('defaultAgent.globalPrefix') + name;
    };
    const handleDefaultAgentChange = (role: DefaultAgentRole, value?: string) => {
      setProjectDefaultAgentsDraft((prev) => ({ ...prev, [role]: value || '' }));
    };

    const handleFormKeyDown = (event: React.KeyboardEvent<HTMLFormElement>) => {
      if (!onEnterSubmit) return;
      const target = event.target as HTMLElement;
      const isSubmitInput = target.tagName === 'INPUT' && !target.closest('.ant-select');
      // 仅项目名称等单行输入框回车提交，避免影响文本域、下拉选择和共享成员操作按钮。
      if (event.key !== 'Enter' || event.nativeEvent.isComposing || !isSubmitInput) {
        return;
      }
      event.preventDefault();
      onEnterSubmit();
    };

    return (
      <>
        <Form
          form={form}
          layout="vertical"
          preserve={false}
          initialValues={formInitialValues}
          onKeyDown={handleFormKeyDown}
        >
          <Form.Item
            name="projectName"
            label={formT('field.projectName')}
            rules={[{ required: true, message: formT('validation.projectNameRequired') }]}
          >
            <Input maxLength={100} placeholder={formT('placeholder.projectName')} />
          </Form.Item>
          <Form.Item name="description" label={formT('field.description')}>
            <Input.TextArea rows={3} maxLength={500} placeholder={formT('placeholder.description')} />
          </Form.Item>
          <Form.Item name="projectType" label={formT('field.projectType')}>
            <Select
              disabled={isEditingDefaultProject}
              loading={projectTypeLoading}
              options={visibleProjectTypeOptions}
              onChange={(value: ProjectSpace['projectType']) => {
                const isForcedSharedType = (isDevelopProjectEnabled && value === 'develop') || value === 'operation';
                if (isForcedSharedType) {
                  form.setFieldValue('sharedFlag', true);
                  return;
                }
                // 切回普通项目时恢复默认不共享，避免沿用强制共享项目的状态。
                form.setFieldValue('sharedFlag', false);
                form.setFields([{ name: 'shareMembers', errors: [] }]);
              }}
            />
          </Form.Item>
          <Form.Item name="sharedFlag" label={formT('field.shared')} valuePropName="checked">
            <Switch
              disabled={isForcedSharedProject || isDefaultProject}
              onChange={(checked) => {
                if (!checked) {
                  form.setFields([{ name: 'shareMembers', errors: [] }]);
                }
              }}
            />
          </Form.Item>
          {isProjectShared && (
            <Form.Item label={formT('field.sharedMembers')}>
              {/* 开启共享时创建者始终自动保留，成员保存和成员列表使用同一接口，无需额外展示必填态。 */}
              <div className={styles.shareTargetField}>
                <Spin spinning={shareMembersLoading}>
                  <div className={styles.shareTargetList}>
                    {selectedShareMembers.map((member) => {
                      const isCreatorMember = isLockedShareMember(member);
                      const isSelfMember = isCurrentUserMember(member);
                      const removeIcon = (
                        <CloseCircleFilled
                          className={styles.shareTargetClose}
                          onClick={() => handleRemoveShareTarget(member)}
                        />
                      );
                      // 共享成员默认不展示姓名 Tooltip，只对创建者和移除自己给出操作提示。
                      const memberItem = (
                        <div className={styles.shareTargetItem}>
                          <div className={styles.userAvatar}>{member.name.slice(-2)}</div>
                          <div className={styles.shareTargetName}>{member.name}</div>
                          {!isCreatorMember &&
                            (isSelfMember ? (
                              <Tooltip title={memberT('removeSelf')} placement="top">
                                {removeIcon}
                              </Tooltip>
                            ) : (
                              removeIcon
                            ))}
                        </div>
                      );

                      if (isCreatorMember) {
                        return (
                          <Tooltip key={member.id} title={memberT('creatorCannotRemove')} placement="top">
                            {memberItem}
                          </Tooltip>
                        );
                      }

                      return <React.Fragment key={member.id}>{memberItem}</React.Fragment>;
                    })}
                    {!selectedShareMembers.length && (
                      <span className={styles.shareTargetEmpty}>{memberT('emptySharedMember')}</span>
                    )}
                    {/* 添加按钮跟随成员标签流式排列，避免独占一整行。 */}
                    <Button
                      size="small"
                      className={styles.shareTargetAddButton}
                      icon={<PlusOutlined />}
                      disabled={shareMembersLoading}
                      onClick={() => setAuthModalOpen(true)}
                    >
                      {memberT('add')}
                    </Button>
                  </div>
                </Spin>
              </div>
            </Form.Item>
          )}
          {isDevelopProject && (
            <Form.Item label={formT('field.defaultAgents')}>
              {/* 默认数字员工仅研发项目可配:三种角色(架构/代码/测试)各可单独指定,留空回退全局默认。 */}
              <div className={styles.defaultAgentField}>
                {DEFAULT_AGENT_ROLES.map((role) => (
                  <div className={styles.defaultAgentRow} key={role}>
                    <span className={styles.defaultAgentLabel}>{formT(`defaultAgent.role.${role}`)}</span>
                    <Select
                      className={styles.defaultAgentSelect}
                      value={projectDefaultAgents[role] || undefined}
                      options={agentSelectOptions}
                      loading={agentOptionsLoading}
                      allowClear
                      showSearch
                      optionFilterProp="label"
                      placeholder={globalDefaultLabel(role)}
                      onChange={(value?: string) => handleDefaultAgentChange(role, value)}
                    />
                  </div>
                ))}
              </div>
            </Form.Item>
          )}
        </Form>
        {authModalOpen && (
          <AddAuthModal
            title={memberT('addSharedMember')}
            value={selectedShareMembers}
            onlyUser
            showPost={false}
            onCancel={() => setAuthModalOpen(false)}
            onOk={(members: any[]) => {
              const memberMap = new Map<string, ProjectShareMember>();
              // 授权弹窗返回的是最终选择；只补回不可删除的创建者，不能再合并已被用户取消的普通成员。
              members.map(normalizeProjectShareMember).forEach((member) => {
                memberMap.set(String(member.userId), member);
              });
              selectedShareMembers.filter(isLockedShareMember).forEach((member) => {
                memberMap.set(String(member.userId), { ...member, cannotDel: true });
              });
              setSelectedShareMembers(
                Array.from(memberMap.values()).map((member) =>
                  // 授权弹窗会按左侧数据重建已选项，新建项目需在合并后再次固定创建者 owner 身份。
                  isNewProjectOwnerMember(member)
                    ? { ...member, role: 'owner', cannotDel: true }
                    : normalizeProjectShareMember(member)
                )
              );
              form.setFields([{ name: 'shareMembers', errors: [] }]);
              setAuthModalOpen(false);
            }}
          />
        )}
      </>
    );
  }
);

ProjectBasicForm.displayName = 'ProjectBasicForm';

export default ProjectBasicForm;
