import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Form, Input, Modal, Radio, Select, message } from 'antd';
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

// 整理配置沿用原型的“已有本体 / 新增本体”两种模式，保存后只写回当前运营需求表单。
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
  const mode = Form.useWatch('mode', form) || 'existing';
  const isSubmitting = loading || submitting;
  const t = useMemo(
    () => (id: string) => intl.formatMessage({ id: `projectSpace.operation.taskForm.knowledge.${id}` }),
    [intl]
  );

  useEffect(() => {
    if (!open) return;
    // 重新打开时回填已保存配置；新增默认选择第一个已有本体，便于快速完成整理配置。
    form.resetFields();
    form.setFieldsValue({
      mode: value?.mode || 'existing',
      templateId: value?.templateId ?? templates[0]?.value,
      templateName: value?.templateName,
      request: value?.request,
      structure: value?.structure,
    });
  }, [form, open, templates, value]);

  const handleSubmit = async () => {
    if (isSubmitting || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const values = await form.validateFields();
      const selectedTemplate = templates.find((template) => `${template.value}` === `${values.templateId}`);
      onSubmit({
        ...values,
        templateId: values.mode === 'existing' ? values.templateId : undefined,
        templateName: values.mode === 'existing' ? selectedTemplate?.label : values.templateName?.trim(),
        request: values.request?.trim(),
        structure: values.structure?.trim(),
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
        <Form.Item name="mode" className={styles.knowledgeOrganizationMode}>
          <Radio.Group disabled={isSubmitting}>
            <Radio.Button value="existing">{t('mode.existing')}</Radio.Button>
            <Radio.Button value="new">{t('mode.new')}</Radio.Button>
          </Radio.Group>
        </Form.Item>
        {mode === 'existing' ? (
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
              notFoundContent={t('emptyTemplate')}
            />
          </Form.Item>
        ) : (
          <>
            <Form.Item
              label={t('field.templateName')}
              name="templateName"
              rules={[{ required: true, whitespace: true, message: t('validation.templateNameRequired') }]}
            >
              <Input maxLength={100} showCount placeholder={t('placeholder.templateName')} />
            </Form.Item>
            <Form.Item
              label={t('field.request')}
              name="request"
              rules={[{ required: true, whitespace: true, message: t('validation.requestRequired') }]}
            >
              <Input.TextArea rows={3} maxLength={1000} showCount placeholder={t('placeholder.request')} />
            </Form.Item>
            <Form.Item
              label={t('field.structure')}
              name="structure"
              rules={[{ required: true, whitespace: true, message: t('validation.structureRequired') }]}
              extra={t('structureHint')}
            >
              <Input.TextArea rows={5} maxLength={2000} showCount placeholder={t('placeholder.structure')} />
            </Form.Item>
          </>
        )}
      </Form>
    </Modal>
  );
};

export default KnowledgeOrganizationModal;
