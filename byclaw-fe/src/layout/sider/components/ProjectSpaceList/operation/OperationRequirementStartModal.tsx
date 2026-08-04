import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Form, Input, Modal, Select, Tooltip, message } from 'antd';
import { useIntl } from '@umijs/max';
import type { OperationSelectOption } from './types';
import styles from './index.module.less';

export type OperationRequirementStartTask = {
  title: string;
  description?: string;
  assignee?: string | number;
};

export interface OperationRequirementStartModalProps {
  open: boolean;
  requirement?: { title?: string; description?: string } | null;
  initialTasks?: OperationRequirementStartTask[];
  assignees?: OperationSelectOption[];
  loading?: boolean;
  onCancel: () => void;
  onSubmit: (tasks: OperationRequirementStartTask[]) => void | Promise<void>;
}

// 启动弹窗只确认拆解结果；真正的任务创建由父组件调用运营需求启动接口完成。
const OperationRequirementStartModal: React.FC<OperationRequirementStartModalProps> = ({
  open,
  requirement,
  initialTasks = [],
  assignees = [],
  loading = false,
  onCancel,
  onSubmit,
}) => {
  const intl = useIntl();
  const [form] = Form.useForm<{ tasks: OperationRequirementStartTask[] }>();
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const isSubmitting = loading || submitting;
  const t = useMemo(
    () => (id: string) => intl.formatMessage({ id: `projectSpace.operation.requirementStart.${id}` }),
    [intl]
  );

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue({ tasks: initialTasks });
  }, [form, initialTasks, open]);

  const handleSubmit = async () => {
    if (isSubmitting || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const values = await form.validateFields();
      await onSubmit(values.tasks || []);
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
      width={760}
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
          <section className={`${styles.operationTaskSection} ${styles.operationRequirementSummary}`}>
            <h3>{requirement?.title || t('unnamedRequirement')}</h3>
            <p>{requirement?.description || t('emptyDescription')}</p>
          </section>
          <section className={styles.operationTaskSection}>
            <Form.List
              name="tasks"
              rules={[
                {
                  validator: async (_, tasks: OperationRequirementStartTask[]) => {
                    if (tasks?.length) return Promise.resolve();
                    return Promise.reject(new Error(t('validation.taskRequired')));
                  },
                },
              ]}
            >
              {(fields, { add, remove }, { errors }) => (
                <>
                  <div className={styles.operationDecomposeHeader}>
                    <h3>{t('decomposeTitle')}</h3>
                    <Button
                      type="dashed"
                      size="small"
                      icon={<PlusOutlined />}
                      disabled={isSubmitting}
                      onClick={() => add({ title: '', description: '', assignee: undefined })}
                    >
                      {t('addTask')}
                    </Button>
                  </div>
                  <div className={styles.operationDecomposeList}>
                    {fields.map((field, index) => (
                      <div key={field.key} className={styles.operationDecomposeItem}>
                        <strong>{index + 1}</strong>
                        <Tooltip title={t('deleteTask')}>
                          <Button
                            type="text"
                            danger
                            size="small"
                            className={styles.operationDecomposeDelete}
                            icon={<DeleteOutlined />}
                            aria-label={t('deleteTask')}
                            disabled={isSubmitting || fields.length <= 1}
                            onClick={(event) => {
                              // 阻止事件继续冒泡到弹窗容器，确保点击删除只更新当前 Form.List 项。
                              event.preventDefault();
                              event.stopPropagation();
                              // 删除 AI 拆解任务前二次确认，避免编辑时误删已调整的任务内容。
                              Modal.confirm({
                                title: t('deleteTaskConfirmTitle'),
                                content: t('deleteTaskConfirmContent'),
                                okText: t('deleteTask'),
                                cancelText: t('cancel'),
                                okButtonProps: { danger: true },
                                onOk: () => remove(index),
                              });
                            }}
                          />
                        </Tooltip>
                        <div className={styles.operationFormGrid}>
                          <Form.Item
                            className={styles.operationFormFull}
                            label={t('field.title')}
                            name={[field.name, 'title']}
                            rules={[{ required: true, whitespace: true, message: t('validation.titleRequired') }]}
                          >
                            <Input maxLength={500} showCount />
                          </Form.Item>
                          <Form.Item
                            className={styles.operationFormFull}
                            label={t('field.description')}
                            name={[field.name, 'description']}
                            rules={[{ required: true, whitespace: true, message: t('validation.descriptionRequired') }]}
                          >
                            <Input.TextArea rows={2} />
                          </Form.Item>
                          <Form.Item
                            label={t('field.assignee')}
                            name={[field.name, 'assignee']}
                            rules={[{ required: true, message: t('validation.assigneeRequired') }]}
                          >
                            <Select options={assignees} showSearch optionFilterProp="label" />
                          </Form.Item>
                        </div>
                      </div>
                    ))}
                  </div>
                  <Form.ErrorList errors={errors} />
                </>
              )}
            </Form.List>
          </section>
        </div>
      </Form>
    </Modal>
  );
};

export default OperationRequirementStartModal;
