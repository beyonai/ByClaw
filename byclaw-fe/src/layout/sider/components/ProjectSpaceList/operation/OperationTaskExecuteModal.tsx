import React, { useEffect, useRef, useState } from 'react';
import { Checkbox, Form, Modal, message } from 'antd';
import { useIntl } from '@umijs/max';
import type { OperationAgentOption } from './types';
import styles from './index.module.less';

export interface OperationTaskExecuteModalProps {
  open: boolean;
  task?: { title?: string; description?: string; assignee?: string; dueTime?: string } | null;
  agents?: OperationAgentOption[];
  loading?: boolean;
  onCancel: () => void;
  onSubmit: (agentIds: Array<string | number>) => void | Promise<void>;
}

// 执行弹窗只收集数字员工选择，后端负责创建会话并保存工作流初始状态。
const OperationTaskExecuteModal: React.FC<OperationTaskExecuteModalProps> = ({
  open,
  task,
  agents = [],
  loading = false,
  onCancel,
  onSubmit,
}) => {
  const intl = useIntl();
  const [form] = Form.useForm<{ agentIds: Array<string | number> }>();
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const isSubmitting = loading || submitting;
  const t = (id: string) => intl.formatMessage({ id: `projectSpace.operation.execute.${id}` });

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue({ agentIds: [] });
  }, [form, open]);

  const handleSubmit = async () => {
    if (isSubmitting || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const values = await form.validateFields();
      await onSubmit(values.agentIds || []);
    } catch (error: any) {
      if (!error?.errorFields) message.error(t('submitFailed'));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      centered
      width={560}
      className={styles.operationTaskModal}
      title={t('title')}
      confirmLoading={isSubmitting}
      closable={!isSubmitting}
      maskClosable={!isSubmitting}
      keyboard={!isSubmitting}
      okText={t('submit')}
      cancelText={t('cancel')}
      cancelButtonProps={{ disabled: isSubmitting }}
      onCancel={onCancel}
      onOk={() => void handleSubmit()}
    >
      <Form form={form} layout="vertical">
        <div className={styles.operationTaskFormBody}>
          <section className={styles.operationTaskSection}>
            <h3>{task?.title || t('unnamedTask')}</h3>
            <p>{task?.description || t('emptyDescription')}</p>
          </section>
          <Form.Item
            className={styles.operationTaskAgentField}
            label={t('agentLabel')}
            name="agentIds"
            rules={[{ required: true, type: 'array', min: 1, message: t('validation.agentRequired') }]}
          >
            <Checkbox.Group className={styles.operationAgentCheckboxGroup} options={agents} />
          </Form.Item>
        </div>
      </Form>
    </Modal>
  );
};

export default OperationTaskExecuteModal;
