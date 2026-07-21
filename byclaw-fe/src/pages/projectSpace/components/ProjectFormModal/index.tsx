import React, { useEffect, useMemo, useState } from 'react';
import { Button, Form, Input, Modal, Select, Spin, Switch, Tooltip, message } from 'antd';
import { CloseCircleFilled, PlusOutlined } from '@ant-design/icons';
import { useSelector } from '@umijs/max';
import AddAuthModal from '@/pages/manager/components/AuthListDrawer/AddAuthModal';
import { listProjectMembers } from '@/service/devloop';
import { getDcSystemConfigListByStandType } from '@/service/system';
import { DEFAULT_PROJECT_TYPE_OPTION, PROJECT_TYPE_OPTIONS, PROJECT_TYPE_STAND_TYPE } from '../../constants';
import type { ProjectSpace } from '../../types';
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
}

export interface ProjectFormValues {
  projectName: string;
  description?: string;
  projectType: ProjectSpace['projectType'];
  sharedFlag: boolean;
  shareMembers?: ProjectShareMember[];
  shareMembersLoaded?: boolean;
}

interface Props {
  open: boolean;
  title?: string;
  loading?: boolean;
  initialValues?: Partial<ProjectFormValues>;
  projectId?: string | number;
  creatorId?: string | number;
  onCancel: () => void;
  onSubmit: (values: ProjectFormValues) => void;
}

type ProjectTypeOption = { label: string; value: ProjectSpace['projectType'] };

const getMemberUserId = (member: any) => member.userId ?? String(member.id || '').replace(/^user_/, '');

const isProjectOwnerMember = (member: any, creatorId?: string | number) => {
  // 新老数据都兼容：新数据有 owner role，老数据用项目创建人 ID 兜底。
  const isOwnerRole = ['owner', 'creator'].includes(`${member?.role || ''}`.toLowerCase());
  return isOwnerRole || (!!creatorId && `${getMemberUserId(member)}` === `${creatorId}`);
};

const getStaticConfigList = (response: any): any[] => {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.data)) return response.data;
  if (Array.isArray(response?.rows)) return response.rows;
  if (Array.isArray(response?.list)) return response.list;
  return [];
};

const getProjectTypeOptionsFromConfig = (response: any): ProjectTypeOption[] => {
  const validProjectTypeSet = new Set(['normal', 'develop', 'default']);

  return getStaticConfigList(response)
    .map((item, index) => {
      const value = `${item?.paramValue || item?.paramEnName || ''}`.trim();
      const label = item?.paramName || item?.paramDesc || item?.paramEnName || value;
      return {
        label,
        value,
        seq: Number(item?.paramSeq ?? index),
      };
    })
    .filter((item) => item.value && validProjectTypeSet.has(item.value))
    .sort((left, right) => left.seq - right.seq)
    .map((item) => ({
      label: item.label,
      value: item.value as ProjectSpace['projectType'],
    }));
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

const ProjectFormModal: React.FC<Props> = ({
  open,
  title = '新建项目空间',
  loading,
  initialValues,
  projectId,
  creatorId,
  onCancel,
  onSubmit,
}) => {
  const userInfo = useSelector((state: any) => state.user?.userInfo) || {};
  const [form] = Form.useForm<ProjectFormValues>();
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [selectedShareMembers, setSelectedShareMembers] = useState<ProjectShareMember[]>([]);
  const [shareMembersLoading, setShareMembersLoading] = useState(false);
  const [shareMembersLoaded, setShareMembersLoaded] = useState(false);
  const [projectTypeConfigOptions, setProjectTypeConfigOptions] = useState<ProjectTypeOption[]>(PROJECT_TYPE_OPTIONS);
  const [projectTypeLoading, setProjectTypeLoading] = useState(false);
  const projectType = Form.useWatch('projectType', form);
  const sharedFlag = Form.useWatch('sharedFlag', form);
  const isDevelopProject = projectType === 'develop';
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
  const isProjectShared = !isDefaultProject && (isDevelopProject || !!sharedFlag);
  const projectTypeOptions = useMemo(() => {
    const configOptions = projectTypeConfigOptions.length ? projectTypeConfigOptions : PROJECT_TYPE_OPTIONS;
    const normalOptions = configOptions.filter((option) => option.value !== 'default');

    // 默认项目只用于编辑默认项目时回显，不放入新建项目和普通项目编辑的下拉选项。
    if (formInitialValues.projectType === 'default') {
      const defaultOption = configOptions.find((option) => option.value === 'default') || DEFAULT_PROJECT_TYPE_OPTION;
      return [defaultOption, ...normalOptions];
    }
    return normalOptions;
  }, [formInitialValues.projectType, projectTypeConfigOptions]);

  useEffect(() => {
    if (!open) return;

    setProjectTypeLoading(true);
    getDcSystemConfigListByStandType(PROJECT_TYPE_STAND_TYPE, { responseCfg: { hideErrorTips: true } })
      .then((response) => {
        const nextOptions = getProjectTypeOptionsFromConfig(response);
        // 静态参数为空时回退本地默认值，避免配置异常导致项目表单不可用。
        setProjectTypeConfigOptions(nextOptions.length ? nextOptions : PROJECT_TYPE_OPTIONS);
      })
      .catch((error) => {
        console.error('Failed to load project type config:', error);
        setProjectTypeConfigOptions(PROJECT_TYPE_OPTIONS);
      })
      .finally(() => {
        setProjectTypeLoading(false);
      });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Antd Form 的 initialValues 只在首次挂载生效，每次打开弹窗时主动重置，避免新建项目带出上次旧值。
    form.resetFields();
    form.setFieldsValue(formInitialValues);
    setSelectedShareMembers((formInitialValues.shareMembers || []).map(normalizeShareMember));
    setShareMembersLoaded(!projectId);
  }, [form, formInitialValues, open, projectId]);

  useEffect(() => {
    if (!open || !projectId) return;

    setShareMembersLoading(true);
    setShareMembersLoaded(false);
    listProjectMembers(Number(projectId))
      .then((res) => {
        const memberList = Array.isArray(res) ? res : [];
        // 共享成员直接使用成员 tab 的同一份项目成员数据，避免共享配置和成员列表两套数据不一致。
        setSelectedShareMembers(memberList.map(normalizeShareMember));
        setShareMembersLoaded(true);
      })
      .catch((error) => {
        console.error('Failed to load project members for share members:', error);
        message.error('共享成员加载失败');
      })
      .finally(() => {
        setShareMembersLoading(false);
      });
  }, [open, projectId]);

  useEffect(() => {
    if (!open || !isDevelopProject) return;
    // 研发项目按规则必须共享，切换到研发时强制打开开关并保留已选共享成员。
    form.setFieldValue('sharedFlag', true);
  }, [form, isDevelopProject, open]);

  useEffect(() => {
    if (!open || !isDefaultProject) return;
    // 默认项目不参与共享成员维护，是否共享固定为否。
    form.setFieldValue('sharedFlag', false);
    form.setFields([{ name: 'shareMembers', errors: [] }]);
  }, [form, isDefaultProject, open]);

  const removeShareMember = (targetId: string) => {
    setSelectedShareMembers((prev) => prev.filter((target) => target.id !== targetId));
  };

  const isCurrentUserMember = (member: ProjectShareMember) => {
    return (
      (!!member.userId && `${member.userId}` === `${userInfo.userId || ''}`) ||
      (!!member.userCode && `${member.userCode}` === `${userInfo.userCode || ''}`)
    );
  };

  const handleRemoveShareTarget = (member: ProjectShareMember) => {
    if (isProjectOwnerMember(member, creatorId)) {
      message.warning('创建者不能被删除');
      return;
    }

    if (isCurrentUserMember(member)) {
      Modal.confirm({
        title: '移除自己',
        content: '保存后你将从该项目共享成员中移除，确定继续吗？',
        okText: '移除',
        okButtonProps: { danger: true },
        onOk: () => removeShareMember(member.id),
      });
      return;
    }

    removeShareMember(member.id);
  };

  const handleModalOk = () => {
    if (loading) return;

    // 后端共享成员保存/校验暂未实现，先不限制必填；实现后恢复下面这段校验。
    // const submitSharedFlag = form.getFieldValue('projectType') === 'develop' || form.getFieldValue('sharedFlag');
    // if (submitSharedFlag && !selectedShareMembers.length) {
    //   form.setFields([{ name: 'shareMembers', errors: ['请选择共享成员'] }]);
    //   return;
    // }
    form.submit();
  };

  const handleFormKeyDown = (event: React.KeyboardEvent<HTMLFormElement>) => {
    const target = event.target as HTMLElement;
    const isSubmitInput = target.tagName === 'INPUT' && !target.closest('.ant-select');
    // 仅项目名称等单行输入框回车提交，避免影响文本域、下拉选择和共享成员操作按钮。
    if (event.key !== 'Enter' || event.nativeEvent.isComposing || !isSubmitInput) {
      return;
    }
    event.preventDefault();
    handleModalOk();
  };

  const handleSubmit = (values: ProjectFormValues) => {
    const submitSharedFlag =
      values.projectType === 'default' ? false : values.projectType === 'develop' || values.sharedFlag;
    // 共享成员由成员 tab 同源数据维护，提交时合并进表单值，避免未注册字段丢失。
    onSubmit({
      ...values,
      sharedFlag: submitSharedFlag,
      shareMembers: submitSharedFlag ? selectedShareMembers : [],
      shareMembersLoaded,
    });
  };

  return (
    <Modal
      destroyOnClose
      title={title}
      open={open}
      confirmLoading={loading}
      okButtonProps={{ disabled: loading }}
      onCancel={onCancel}
      onOk={handleModalOk}
      width={720}
    >
      <Form
        form={form}
        layout="vertical"
        preserve={false}
        initialValues={formInitialValues}
        onFinish={handleSubmit}
        onKeyDown={handleFormKeyDown}
      >
        <Form.Item name="projectName" label="项目名称" rules={[{ required: true, message: '请输入项目名称' }]}>
          <Input maxLength={100} placeholder="请输入项目名称" />
        </Form.Item>
        <Form.Item name="description" label="项目描述">
          <Input.TextArea rows={3} maxLength={500} placeholder="请输入项目描述" />
        </Form.Item>
        <Form.Item name="projectType" label="项目类型">
          <Select
            disabled={isEditingDefaultProject}
            loading={projectTypeLoading}
            options={projectTypeOptions}
            onChange={(value: ProjectSpace['projectType']) => {
              if (value === 'develop') {
                form.setFieldValue('sharedFlag', true);
                return;
              }
              // 切回普通项目时恢复默认不共享，避免沿用研发项目的强制共享状态。
              form.setFieldValue('sharedFlag', false);
              form.setFields([{ name: 'shareMembers', errors: [] }]);
            }}
          />
        </Form.Item>
        <Form.Item name="sharedFlag" label="是否共享" valuePropName="checked">
          <Switch
            disabled={isDevelopProject || isDefaultProject}
            onChange={(checked) => {
              if (!checked) {
                form.setFields([{ name: 'shareMembers', errors: [] }]);
              }
            }}
          />
        </Form.Item>
        {isProjectShared && (
          <Form.Item label="共享成员">
            {/* 后端共享成员保存/校验暂未实现，先不展示必填态；实现后恢复 required/validateStatus/help。 */}
            <div className={styles.shareTargetField}>
              <Spin spinning={shareMembersLoading}>
                <div className={styles.shareTargetList}>
                  {selectedShareMembers.map((member) => {
                    const isCreatorMember = isProjectOwnerMember(member, creatorId);
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
                            <Tooltip title="移除自己" placement="top">
                              {removeIcon}
                            </Tooltip>
                          ) : (
                            removeIcon
                          ))}
                      </div>
                    );

                    if (isCreatorMember) {
                      return (
                        <Tooltip key={member.id} title="不允许移除创建者" placement="top">
                          {memberItem}
                        </Tooltip>
                      );
                    }

                    return <React.Fragment key={member.id}>{memberItem}</React.Fragment>;
                  })}
                  {!selectedShareMembers.length && <span className={styles.shareTargetEmpty}>暂无共享成员</span>}
                  {/* 添加按钮跟随成员标签流式排列，避免独占一整行。 */}
                  <Button
                    size="small"
                    className={styles.shareTargetAddButton}
                    icon={<PlusOutlined />}
                    disabled={shareMembersLoading}
                    onClick={() => setAuthModalOpen(true)}
                  >
                    添加
                  </Button>
                </div>
              </Spin>
            </div>
          </Form.Item>
        )}
      </Form>
      {authModalOpen && (
        <AddAuthModal
          title="新增共享成员"
          value={selectedShareMembers}
          onlyUser
          showPost={false}
          onCancel={() => setAuthModalOpen(false)}
          onOk={(members: any[]) => {
            const memberMap = new Map<string, ProjectShareMember>();
            [...selectedShareMembers, ...members.map(normalizeShareMember)].forEach((member) => {
              memberMap.set(String(member.userId), member);
            });
            setSelectedShareMembers(Array.from(memberMap.values()));
            form.setFields([{ name: 'shareMembers', errors: [] }]);
            setAuthModalOpen(false);
          }}
        />
      )}
    </Modal>
  );
};

export default ProjectFormModal;
