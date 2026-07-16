import React, { useEffect, useMemo } from 'react';
import { Form, Input, Modal, Select, Switch } from 'antd';
import { PROJECT_TYPE_OPTIONS } from '../../constants';
import type { ProjectSpace } from '../../types';

export interface ProjectFormValues {
  projectName: string;
  description?: string;
  projectType: ProjectSpace['projectType'];
  sharedFlag: boolean;
}

interface Props {
  open: boolean;
  title?: string;
  loading?: boolean;
  initialValues?: Partial<ProjectFormValues>;
  onCancel: () => void;
  onSubmit: (values: ProjectFormValues) => void;
}

const ProjectFormModal: React.FC<Props> = ({
  open,
  title = '新建项目空间',
  loading,
  initialValues,
  onCancel,
  onSubmit,
}) => {
  const [form] = Form.useForm<ProjectFormValues>();
  const formInitialValues = useMemo(
    () => ({
      projectName: '',
      description: '',
      projectType: 'normal' as ProjectSpace['projectType'],
      sharedFlag: false,
      ...initialValues,
    }),
    [initialValues]
  );

  useEffect(() => {
    if (!open) return;
    // Antd Form 的 initialValues 只在首次挂载生效，每次打开弹窗时主动重置，避免新建项目带出上次旧值。
    form.resetFields();
    form.setFieldsValue(formInitialValues);
  }, [form, formInitialValues, open]);

  return (
    <Modal
      destroyOnClose
      title={title}
      open={open}
      confirmLoading={loading}
      onCancel={onCancel}
      onOk={() => form.submit()}
    >
      <Form form={form} layout="vertical" preserve={false} initialValues={formInitialValues} onFinish={onSubmit}>
        <Form.Item name="projectName" label="项目名称" rules={[{ required: true, message: '请输入项目名称' }]}>
          <Input maxLength={100} placeholder="请输入项目名称" />
        </Form.Item>
        <Form.Item name="description" label="项目描述">
          <Input.TextArea rows={3} maxLength={500} placeholder="请输入项目描述" />
        </Form.Item>
        <Form.Item name="projectType" label="项目类型">
          <Select options={PROJECT_TYPE_OPTIONS} />
        </Form.Item>
        <Form.Item name="sharedFlag" label="是否共享" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default ProjectFormModal;
