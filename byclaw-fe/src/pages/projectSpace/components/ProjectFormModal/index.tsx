import React, { useRef } from 'react';
import { Form, Modal } from 'antd';
import { useIntl } from '@umijs/max';
import type { ProjectTypeOption } from '../../hooks/useProjectTypeConfig';
import ProjectBasicForm, { type ProjectBasicFormHandle, type ProjectFormValues } from './ProjectBasicForm';
import styles from './index.module.less';

export type { ProjectFormValues, ProjectShareMember } from './ProjectBasicForm';

interface Props {
  open: boolean;
  title?: string;
  loading?: boolean;
  initialValues?: Partial<ProjectFormValues>;
  projectId?: string | number;
  creatorId?: string | number;
  projectTypeConfigOptions?: ProjectTypeOption[];
  projectTypeLoading?: boolean;
  onCancel: () => void;
  onSubmit: (values: ProjectFormValues) => void;
}

// 薄壳:仅负责 Modal 外壳 + 确认时序,表单主体与共享/默认员工逻辑全在 ProjectBasicForm(与新建向导 step1 复用)。
const ProjectFormModal: React.FC<Props> = ({
  open,
  title,
  loading,
  initialValues,
  projectId,
  creatorId,
  projectTypeConfigOptions,
  projectTypeLoading,
  onCancel,
  onSubmit,
}) => {
  const intl = useIntl();
  const [form] = Form.useForm<ProjectFormValues>();
  const basicRef = useRef<ProjectBasicFormHandle>(null);
  const formT = (id: string) => intl.formatMessage({ id: `projectSpace.projectForm.${id}` });

  const handleModalOk = async () => {
    // 项目类型能力未确认前不提交，避免历史研发项目被按普通项目规则保存。
    if (loading || projectTypeLoading) return;
    const values = await basicRef.current?.collectValues();
    if (values) onSubmit(values);
  };

  return (
    <Modal
      className={styles.projectFormModal}
      destroyOnClose
      title={title || formT(projectId ? 'editTitle' : 'createTitle')}
      open={open}
      confirmLoading={loading}
      centered
      // 表单内容较长时只滚动弹窗内容区，避免滚动条落到项目空间页面本身。
      styles={{
        body: {
          maxHeight: 'calc(100vh - 220px)',
          overflowY: 'auto',
          paddingInlineEnd: 8,
        },
      }}
      okButtonProps={{ disabled: loading || projectTypeLoading }}
      onCancel={onCancel}
      onOk={handleModalOk}
      width={720}
    >
      <ProjectBasicForm
        ref={basicRef}
        open={open}
        form={form}
        initialValues={initialValues}
        projectId={projectId}
        creatorId={creatorId}
        projectTypeConfigOptions={projectTypeConfigOptions}
        projectTypeLoading={projectTypeLoading}
        onEnterSubmit={handleModalOk}
      />
    </Modal>
  );
};

export default ProjectFormModal;
