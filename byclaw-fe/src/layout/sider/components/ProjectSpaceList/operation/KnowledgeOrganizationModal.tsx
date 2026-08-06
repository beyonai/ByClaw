import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Form, Modal, Select, message } from 'antd';
import { useIntl } from '@umijs/max';
import type { OperationKnowledgeOrganization, OperationSelectOption } from './types';
import styles from './index.module.less';

type KnowledgeOrganizationFormValues = OperationKnowledgeOrganization;

export interface KnowledgeOrganizationModalProps {
  open: boolean;
  value?: OperationKnowledgeOrganization;
  templates?: OperationSelectOption[];
  loading?: boolean;
  onCancel: () => void;
  onSubmit: (value: OperationKnowledgeOrganization) => void;
}

// 该组件保留用于兼容历史引用；当前知识整理已改为在需求表单内直接选择本地已有本体。
const KnowledgeOrganizationModal: React.FC<KnowledgeOrganizationModalProps> = ({
  open,
  value,
  templates = [],
  loading = false,
  onCancel,
  onSubmit,
}) => {
  const intl = useIntl();
  const [form] = Form.useForm<KnowledgeOrganizationFormValues>();
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  // 记录本次打开是否已经完成初始化，避免模板异步刷新或父表单回写时重复 resetFields 清空用户输入。
  const initializedOpenRef = useRef(false);
  const isSubmitting = loading || submitting;
  const t = useMemo(
    () => (id: string) => intl.formatMessage({ id: `projectSpace.operation.taskForm.knowledge.${id}` }),
    [intl]
  );

  useEffect(() => {
    if (!open) {
      initializedOpenRef.current = false;
      return;
    }
    if (initializedOpenRef.current) return;
    initializedOpenRef.current = true;
    // 每次真正打开时回填已保存配置；后续模板列表变化不得重复覆盖当前选择。
    form.resetFields();
    form.setFieldsValue({
      mode: 'existing',
      templateId: value?.templateId ?? templates[0]?.value,
    });
  }, [form, open, templates, value]);

  useEffect(() => {
    if (!open || !templates.length || form.getFieldValue('templateId') !== undefined) return;
    // 本体列表异步返回时只补默认选项，不重置表单，避免覆盖用户已经选择的本体。
    form.setFieldValue('templateId', templates[0].value);
  }, [form, open, templates]);

  const handleSubmit = async () => {
    if (isSubmitting || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const values = await form.validateFields();
      const selectedTemplate = templates.find((template) => `${template.value}` === `${values.templateId}`);
      onSubmit({
        mode: 'existing',
        templateId: values.templateId,
        templateName: selectedTemplate?.label,
      });
    } catch (error: any) {
      if (!error?.errorFields) message.error(t('saveFailed'));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      centered
      width={640}
      zIndex={1100}
      className={`${styles.operationTaskModal} ${styles.knowledgeOrganizationModal}`}
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
      <p className={styles.knowledgeOrganizationIntro}>{t('description')}</p>
      <Form form={form} layout="vertical">
        <Form.Item
          label={t('field.template')}
          name="templateId"
          rules={[{ required: true, message: t('validation.templateRequired') }]}
        >
          <Select
            options={templates}
            loading={loading}
            showSearch
            optionFilterProp="label"
            placeholder={t('placeholder.template')}
            notFoundContent={null}
          />
        </Form.Item>
        {/* “新增本体”表单暂时停用，知识整理只允许选择本地已有本体，避免再次嵌套弹窗。 */}
      </Form>
    </Modal>
  );
};

export default KnowledgeOrganizationModal;
