import React, { useEffect, useMemo, useState } from 'react';
import { Button, Form, Input, Modal, Select, Switch, Tooltip } from 'antd';
import { CloseCircleFilled, PlusOutlined } from '@ant-design/icons';
import AddAuthModal from '@/pages/manager/components/AuthListDrawer/AddAuthModal';
import AntdIcon from '@/components/AntdIcon';
import { PROJECT_TYPE_OPTIONS } from '../../constants';
import type { ProjectShareTarget, ProjectSpace } from '../../types';
import styles from './index.module.less';

export interface ProjectFormValues {
  projectName: string;
  description?: string;
  projectType: ProjectSpace['projectType'];
  sharedFlag: boolean;
  shareTargets?: ProjectShareTarget[];
}

interface Props {
  open: boolean;
  title?: string;
  loading?: boolean;
  initialValues?: Partial<ProjectFormValues>;
  onCancel: () => void;
  onSubmit: (values: ProjectFormValues) => void;
}

const getShareTargetName = (target: ProjectShareTarget) => target.name || target.targetName || '';

const getShareTargetType = (target: ProjectShareTarget) => String(target.type || target.targetType || '').toUpperCase();

const ProjectFormModal: React.FC<Props> = ({
  open,
  title = '新建项目空间',
  loading,
  initialValues,
  onCancel,
  onSubmit,
}) => {
  const [form] = Form.useForm<ProjectFormValues>();
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [selectedShareTargets, setSelectedShareTargets] = useState<ProjectShareTarget[]>([]);
  const projectType = Form.useWatch('projectType', form);
  const sharedFlag = Form.useWatch('sharedFlag', form);
  const isDevelopProject = projectType === 'develop';
  const isProjectShared = isDevelopProject || !!sharedFlag;
  const formInitialValues = useMemo(
    () => ({
      projectName: '',
      description: '',
      projectType: 'normal' as ProjectSpace['projectType'],
      sharedFlag: false,
      shareTargets: [],
      ...initialValues,
    }),
    [initialValues]
  );

  useEffect(() => {
    if (!open) return;
    // Antd Form 的 initialValues 只在首次挂载生效，每次打开弹窗时主动重置，避免新建项目带出上次旧值。
    form.resetFields();
    form.setFieldsValue(formInitialValues);
    setSelectedShareTargets(formInitialValues.shareTargets || []);
  }, [form, formInitialValues, open]);

  useEffect(() => {
    if (!open || !isDevelopProject) return;
    // 研发项目按规则必须共享，切换到研发时强制打开开关并保留已选共享对象。
    form.setFieldValue('sharedFlag', true);
  }, [form, isDevelopProject, open]);

  const handleRemoveShareTarget = (targetId: string) => {
    setSelectedShareTargets((prev) => prev.filter((target) => target.id !== targetId));
  };

  const handleModalOk = () => {
    if (loading) return;

    // 后端共享对象保存/校验暂未实现，先不限制必填；实现后恢复下面这段校验。
    // const submitSharedFlag = form.getFieldValue('projectType') === 'develop' || form.getFieldValue('sharedFlag');
    // if (submitSharedFlag && !selectedShareTargets.length) {
    //   form.setFields([{ name: 'shareTargets', errors: ['请选择共享对象'] }]);
    //   return;
    // }
    form.submit();
  };

  const handleSubmit = (values: ProjectFormValues) => {
    const submitSharedFlag = values.projectType === 'develop' || values.sharedFlag;
    // 共享对象由授权弹窗维护本地状态，提交时合并进表单值，避免未注册字段丢失。
    onSubmit({
      ...values,
      sharedFlag: submitSharedFlag,
      shareTargets: submitSharedFlag ? selectedShareTargets : [],
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
      <Form form={form} layout="vertical" preserve={false} initialValues={formInitialValues} onFinish={handleSubmit}>
        <Form.Item name="projectName" label="项目名称" rules={[{ required: true, message: '请输入项目名称' }]}>
          <Input maxLength={100} placeholder="请输入项目名称" />
        </Form.Item>
        <Form.Item name="description" label="项目描述">
          <Input.TextArea rows={3} maxLength={500} placeholder="请输入项目描述" />
        </Form.Item>
        <Form.Item name="projectType" label="项目类型">
          <Select
            options={PROJECT_TYPE_OPTIONS}
            onChange={(value: ProjectSpace['projectType']) => {
              if (value === 'develop') {
                form.setFieldValue('sharedFlag', true);
                return;
              }
              // 切回普通项目时恢复默认不共享，避免沿用研发项目的强制共享状态。
              form.setFieldValue('sharedFlag', false);
              setSelectedShareTargets([]);
              form.setFields([{ name: 'shareTargets', errors: [] }]);
            }}
          />
        </Form.Item>
        <Form.Item name="sharedFlag" label="是否共享" valuePropName="checked">
          <Switch
            disabled={isDevelopProject}
            onChange={(checked) => {
              if (!checked) {
                setSelectedShareTargets([]);
                form.setFields([{ name: 'shareTargets', errors: [] }]);
              }
            }}
          />
        </Form.Item>
        {isProjectShared && (
          <Form.Item label="共享对象">
            {/* 后端共享对象保存/校验暂未实现，先不展示必填态；实现后恢复 required/validateStatus/help。 */}
            <div className={styles.shareTargetField}>
              <div className={styles.shareTargetList}>
                {selectedShareTargets.map((target) => (
                  <div key={target.id} className={styles.shareTargetItem}>
                    {getShareTargetType(target) === 'USER' ? (
                      <div className={styles.userAvatar}>{getShareTargetName(target).slice(-2)}</div>
                    ) : (
                      <div className={styles.orgAvatar}>
                        <AntdIcon type="icon-a-Chart-graphguanxitu" style={{ fontSize: 14 }} />
                      </div>
                    )}
                    <Tooltip title={getShareTargetName(target)} placement="top">
                      <div className={styles.shareTargetName}>{getShareTargetName(target)}</div>
                    </Tooltip>
                    <CloseCircleFilled
                      className={styles.shareTargetClose}
                      onClick={() => handleRemoveShareTarget(target.id)}
                    />
                  </div>
                ))}
              </div>
              <Button icon={<PlusOutlined />} onClick={() => setAuthModalOpen(true)}>
                新增授权对象
              </Button>
            </div>
          </Form.Item>
        )}
      </Form>
      {authModalOpen && (
        <AddAuthModal
          title="新增授权对象"
          value={selectedShareTargets}
          allowedTypes={['ORG', 'USER']}
          showPost={false}
          onCancel={() => setAuthModalOpen(false)}
          onOk={(targets: ProjectShareTarget[]) => {
            setSelectedShareTargets(targets);
            form.setFields([{ name: 'shareTargets', errors: [] }]);
            setAuthModalOpen(false);
          }}
        />
      )}
    </Modal>
  );
};

export default ProjectFormModal;
