import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { Button, Form, Input, Modal, Select, Spin, Switch, Tooltip, message } from 'antd';
import type { FormInstance } from 'antd';
import { CloseCircleFilled, PlusOutlined } from '@ant-design/icons';
import { useIntl, useSelector } from '@umijs/max';
import AddAuthModal from '@/pages/manager/components/AuthListDrawer/AddAuthModal';
import { listResourceUseAuth } from '@/pages/manager/service/resources';
import { listProjectMembers } from '@/service/devloop';
import { listOntologyBases, pageOntologyResources } from '@/service/ontology';
import { ResourceTypeMap } from '@/constants/resource';
import type { ProjectResourcePayload, ProjectResourceType } from '@/service/devloop';
import type { ProjectTypeOption } from '../../hooks/useProjectTypeConfig';
import type { ProjectSpace } from '../../types';
import type { DefaultAgentConfig } from '@/service/devloop';
import { useDigitalEmployeeOptions } from '../../hooks/useDigitalEmployeeOptions';
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
  // 每项目默认助理覆盖(架构/需求/研发/测试)已解析为后端保存入参;空值角色代表沿用全局默认。
  defaultAgents?: DefaultAgentConfig;
  resources?: ProjectResourcePayload[];
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
    { open, form, initialValues, projectId, creatorId, onEnterSubmit },
    ref
  ) => {
    const intl = useIntl();
    const userInfo = useSelector((state: any) => state.user?.userInfo) || {};
    const [authModalOpen, setAuthModalOpen] = useState(false);
    const [selectedShareMembers, setSelectedShareMembers] = useState<ProjectShareMember[]>([]);
    const [shareMembersLoading, setShareMembersLoading] = useState(false);
    const [shareMembersLoaded, setShareMembersLoaded] = useState(false);
    const [knowledgeResourceOptions, setKnowledgeResourceOptions] = useState<{ value: string; label: string }[]>([]);
    const [ontologyResourceOptions, setOntologyResourceOptions] = useState<{ value: string; label: string }[]>([]);
    const [resourceOptionsLoading, setResourceOptionsLoading] = useState(false);
    const [selectedResources, setSelectedResources] = useState<Record<ProjectResourceType, string[]>>({
      knowledge: [],
      digital_employee: [],
      ontology: [],
    });
    const [resourceValidationTriggered, setResourceValidationTriggered] = useState(false);
    const { options: agentOptions, loading: agentOptionsLoading } = useDigitalEmployeeOptions(open);
    const currentUserId = userInfo.userId ?? userInfo.id;
    const currentUserCode = userInfo.userCode;
    const currentUserName = userInfo.userName || userInfo.userNickName || userInfo.nickName || currentUserCode;
    const formT = useCallback((id: string) => intl.formatMessage({ id: `projectSpace.projectForm.${id}` }), [intl]);
    const memberT = useCallback((id: string) => intl.formatMessage({ id: `projectSpace.members.${id}` }), [intl]);
    const isDevelopProjectEnabled = false;
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
        // 创建项目默认为普通项目；编辑已有项目时保留原类型，仅隐藏类型字段不再允许修改。
        projectType: initialValues?.projectType || ('normal' as ProjectSpace['projectType']),
      };
      if (values.projectType === 'default') {
        // 默认项目固定为不共享，编辑弹窗回显时也不使用接口里的共享值。
        values.sharedFlag = false;
      }
      return values;
    }, [initialValues]);
    const isDefaultProject = projectType === 'default';
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
    useEffect(() => {
      if (!open) return;
      // Antd Form 的 initialValues 只在首次挂载生效，每次打开弹窗时主动重置，避免新建项目带出上次旧值。
      form.resetFields();
      form.setFieldsValue(formInitialValues);
      setSelectedShareMembers((formInitialValues.shareMembers || []).map(normalizeProjectShareMember));
      const initialResources = formInitialValues.resources || [];
      setSelectedResources({
        knowledge: initialResources
          .filter((resource) => resource.resourceType === 'knowledge')
          .map((resource) => `${resource.resourceId}`),
        digital_employee: initialResources
          .filter((resource) => resource.resourceType === 'digital_employee')
          .map((resource) => `${resource.resourceId}`),
        ontology: initialResources
          .filter((resource) => resource.resourceType === 'ontology')
          .map((resource) => `${resource.resourceId}`),
      });
      setResourceValidationTriggered(false);
      setShareMembersLoaded(!projectId);
    }, [form, formInitialValues, normalizeProjectShareMember, open, projectId]);

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
      if (!open) return;
      let cancelled = false;
      const getArray = (...candidates: any[]) => candidates.find((candidate) => Array.isArray(candidate)) || [];
      const loadResourceOptions = async () => {
        setResourceOptionsLoading(true);
        try {
          const knowledgeQuery = {
            pageNum: 1,
            pageSize: 100,
            resourceBizTypeList: [
              ResourceTypeMap.knowledgeBase,
              ResourceTypeMap.knowledgeBaseQa,
              ResourceTypeMap.knowledgeBaseTerm,
            ],
          };
          const [
            knowledgePersonal,
            knowledgeEnterprise,
            ontologyPersonal,
            ontologyEnterprise,
            ontologyResourcePersonal,
            ontologyResourceEnterprise,
          ] = await Promise.all([
            // 与“知识”模块保持一致，分别加载当前账号可用的个人知识和企业知识。
            listResourceUseAuth({
              ...knowledgeQuery,
              ownerType: 'personal',
              resourceStatus: '2',
              permission: '',
            }),
            listResourceUseAuth({
              ...knowledgeQuery,
              ownerType: 'enterprise',
              resourceStatus: '2',
              permission: '',
              belong: 'ALL',
            }),
            listOntologyBases({ ownerType: 'personal' }),
            listOntologyBases({ ownerType: 'enterprise' }),
            // 本体中心卡片使用资源分页接口；同时读取该接口，覆盖本体库列表接口未返回的企业本体资源。
            pageOntologyResources({
              ownerType: 'personal',
              resourceBizTypeList: ['VIEW', 'OBJECT'],
              statusList: [0, 1, 2, 3, 4, 5],
              pageNum: 1,
              pageSize: 1000,
            }),
            pageOntologyResources({
              ownerType: 'enterprise',
              resourceBizTypeList: ['VIEW', 'OBJECT'],
              statusList: [0, 1, 2, 3, 4, 5],
              pageNum: 1,
              pageSize: 1000,
            }),
          ]);
          if (cancelled) return;
          const knowledgeMap = new Map<string, { value: string; label: string }>();
          [
            ...getArray(
              knowledgePersonal?.rows,
              knowledgePersonal?.list,
              knowledgePersonal?.data?.rows,
              knowledgePersonal?.data?.list
            ),
            ...getArray(
              knowledgeEnterprise?.rows,
              knowledgeEnterprise?.list,
              knowledgeEnterprise?.data?.rows,
              knowledgeEnterprise?.data?.list
            ),
          ].forEach((item: any) => {
            const value = item.resourceId ?? item.resourceSourcePkId ?? item.datasetId ?? item.id;
            const label = item.resourceName || item.datasetName || item.name;
            if (value !== undefined && value !== null && label)
              knowledgeMap.set(`${value}`, { value: `${value}`, label });
          });
          const ontologyMap = new Map<string, { value: string; label: string }>();
          [ontologyPersonal, ontologyEnterprise, ontologyResourcePersonal, ontologyResourceEnterprise].forEach(
            (response) => {
              // 本体模块接口可能直接返回数组，也可能包在 data/list/rows 中，统一兼容后合并个人和企业本体。
              getArray(
                response,
                response?.list,
                response?.records,
                response?.rows,
                response?.data,
                response?.data?.list,
                response?.data?.records,
                response?.data?.rows,
                response?.data?.data,
                response?.data?.data?.list,
                response?.data?.data?.records,
                response?.data?.data?.rows
              ).forEach((item: any) => {
                const value = item.baseId ?? item.resourceId ?? item.id;
                const label = item.displayName || item.resourceName || item.name;
                if (value !== undefined && value !== null && label)
                  ontologyMap.set(`${value}`, { value: `${value}`, label });
              });
            }
          );
          setKnowledgeResourceOptions(Array.from(knowledgeMap.values()));
          setOntologyResourceOptions(Array.from(ontologyMap.values()));
        } catch (error) {
          console.error('Failed to load project resource options:', error);
          if (!cancelled) {
            setKnowledgeResourceOptions([]);
            setOntologyResourceOptions([]);
          }
        } finally {
          if (!cancelled) setResourceOptionsLoading(false);
        }
      };
      void loadResourceOptions();
      return () => {
        cancelled = true;
      };
    }, [open]);

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

    // 合并表单原始值与共享成员/项目资源副本,强制校正共享标记,产出后端保存入参。
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
          // 绑定项目资源仅属于运营项目；切换为普通/研发项目时不再提交旧的绑定关系。
          resources: isOperationProject
            ? (Object.entries(selectedResources) as [ProjectResourceType, string[]][]).flatMap(
              ([resourceType, resourceIds]) =>
                resourceIds.map((resourceId, index) => ({
                  resourceType,
                  resourceId,
                  resourceName:
                      (resourceType === 'digital_employee'
                        ? agentLabelById.get(resourceId)
                        : resourceType === 'knowledge'
                          ? knowledgeResourceOptions.find((option) => option.value === resourceId)?.label
                          : ontologyResourceOptions.find((option) => option.value === resourceId)?.label) || undefined,
                  sortNo: index,
                }))
            )
            : [],
        };
      },
      [
        agentLabelById,
        isDevelopProjectEnabled,
        knowledgeResourceOptions,
        ontologyResourceOptions,
        selectedResources,
        selectedShareMembers,
        shareMembersLoaded,
        isOperationProject,
      ]
    );

    useImperativeHandle(
      ref,
      () => ({
        collectValues: async () => {
          // 绑定资源仅在运营项目必填，其他项目类型隐藏该区域且不触发资源校验。
          setResourceValidationTriggered(isOperationProject);
          const hasMissingResource = (['knowledge', 'digital_employee', 'ontology'] as ProjectResourceType[]).some(
            (resourceType) => isOperationProject && selectedResources[resourceType].length === 0
          );
          try {
            const values = await form.validateFields();
            if (hasMissingResource) return null;
            return buildSubmitValues(values);
          } catch {
            // 校验失败:antd 已在字段下方标红,父级据 null 中止提交。
            return null;
          }
        },
      }),
      [buildSubmitValues, form, isOperationProject, selectedResources]
    );

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
            rules={[
              { required: true, message: formT('validation.projectNameRequired') },
              { max: 15, message: formT('validation.projectNameMaxLength') },
            ]}
          >
            <Input maxLength={15} showCount placeholder={formT('placeholder.projectName')} />
          </Form.Item>
          <Form.Item
            name="description"
            label={formT('field.description')}
            rules={[{ max: 500, message: formT('validation.descriptionMaxLength') }]}
          >
            {/* 项目描述限制 500 字，默认展示两行，避免新建项目弹窗被描述字段撑高。 */}
            <Input.TextArea rows={2} maxLength={500} showCount placeholder={formT('placeholder.description')} />
          </Form.Item>
          {isOperationProject && (
            <Form.Item label={formT('field.resources')}>
              {/* 三类资源共用项目绑定关系表；该配置只适用于运营项目。 */}
              <div className={styles.projectResourceFields}>
                <div
                  className={
                    resourceValidationTriggered && !selectedResources.knowledge.length
                      ? styles.projectResourceFieldError
                      : undefined
                  }
                >
                  <div className={styles.projectResourceLabel}>{formT('resource.knowledge')}</div>
                  <Select
                    mode="multiple"
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    value={selectedResources.knowledge}
                    options={knowledgeResourceOptions}
                    loading={resourceOptionsLoading}
                    placeholder={formT('resource.knowledgePlaceholder')}
                    onChange={(value: string[]) => setSelectedResources((prev) => ({ ...prev, knowledge: value }))}
                  />
                  {resourceValidationTriggered && !selectedResources.knowledge.length && (
                    <div className={styles.projectResourceError}>{formT('validation.knowledgeRequired')}</div>
                  )}
                </div>
                <div
                  className={
                    resourceValidationTriggered && !selectedResources.digital_employee.length
                      ? styles.projectResourceFieldError
                      : undefined
                  }
                >
                  <div className={styles.projectResourceLabel}>{formT('resource.digitalEmployee')}</div>
                  <Select
                    mode="multiple"
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    value={selectedResources.digital_employee}
                    options={agentSelectOptions}
                    loading={agentOptionsLoading}
                    placeholder={formT('resource.digitalEmployeePlaceholder')}
                    onChange={(value: string[]) =>
                      setSelectedResources((prev) => ({ ...prev, digital_employee: value }))
                    }
                  />
                  {resourceValidationTriggered && !selectedResources.digital_employee.length && (
                    <div className={styles.projectResourceError}>{formT('validation.digitalEmployeeRequired')}</div>
                  )}
                </div>
                <div
                  className={
                    resourceValidationTriggered && !selectedResources.ontology.length
                      ? styles.projectResourceFieldError
                      : undefined
                  }
                >
                  <div className={styles.projectResourceLabel}>{formT('resource.ontology')}</div>
                  <Select
                    mode="multiple"
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    value={selectedResources.ontology}
                    options={ontologyResourceOptions}
                    loading={resourceOptionsLoading}
                    placeholder={formT('resource.ontologyPlaceholder')}
                    onChange={(value: string[]) => setSelectedResources((prev) => ({ ...prev, ontology: value }))}
                  />
                  {resourceValidationTriggered && !selectedResources.ontology.length && (
                    <div className={styles.projectResourceError}>{formT('validation.ontologyRequired')}</div>
                  )}
                </div>
              </div>
            </Form.Item>
          )}
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
