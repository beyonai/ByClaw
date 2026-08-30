import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Form, Input, Modal, Radio, message } from 'antd';
import { useIntl } from '@umijs/max';
import type { OperationAccount, OperationAccountFormValues, OperationPlatformOption } from './types';
import styles from './index.module.less';

// 运营账号新增、编辑共用同一弹窗；账号持久化和登录流程由父组件按后端接口能力接入。
export interface OperationAccountFormModalProps {
  open: boolean;
  account?: OperationAccount | null;
  platformOptions?: OperationPlatformOption[];
  fixedPlatformId?: string;
  loading?: boolean;
  onCancel: () => void;
  onSubmit: (values: OperationAccountFormValues, account?: OperationAccount | null) => void | Promise<void>;
}

// 表单校验失败不再重复提示保存失败，只有真实接口或运行异常才展示错误消息。
const isFormValidationError = (error: unknown) => typeof error === 'object' && error !== null && 'errorFields' in error;

const OperationAccountFormModal: React.FC<OperationAccountFormModalProps> = ({
  open,
  account,
  platformOptions,
  fixedPlatformId,
  loading = false,
  onCancel,
  onSubmit,
}) => {
  const intl = useIntl();
  const [form] = Form.useForm<OperationAccountFormValues>();
  const [submitting, setSubmitting] = useState(false);
  // 状态更新存在一个渲染间隔，使用同步标记拦截这个间隔内的连续点击。
  const submittingRef = useRef(false);
  const [selectedPlatform, setSelectedPlatform] = useState<string>(fixedPlatformId || account?.platformId || '');
  const t = useCallback((id: string) => intl.formatMessage({ id: `projectSpace.operation.accountForm.${id}` }), [intl]);
  const platformT = useCallback(
    (id: string) => intl.formatMessage({ id: `projectSpace.operation.platform.${id}` }),
    [intl]
  );
  // 后端未下发平台配置时使用产品约定的平台集合，保证新增账号的基础表单可用。
  const defaultPlatformOptions = useMemo<OperationPlatformOption[]>(
    () => [
      // 账号平台统一保存正式编码，历史短编码只在读取和登录适配层兼容。
      { value: 'WeChatAccount', label: platformT('wechat') },
      { value: 'Xiaohongshu', label: platformT('xiaohongshu') },
      { value: 'WeChatChannels', label: platformT('video') },
      { value: 'Douyin', label: platformT('douyin') },
      { value: 'CustomLink', label: platformT('customLink') },
    ],
    [platformT]
  );
  const availablePlatformOptions = platformOptions?.length ? platformOptions : defaultPlatformOptions;
  const defaultPlatformId = availablePlatformOptions[0]?.value;
  const isSubmitting = loading || submitting;

  useEffect(() => {
    if (!open) return;
    // 每次打开都按当前编辑对象重置，避免上一次新增或编辑残留到下一次操作。
    form.resetFields();
    const platformId = fixedPlatformId || account?.platformId || defaultPlatformId;
    setSelectedPlatform(platformId);
    form.setFieldsValue({
      platformId,
      accountName: account?.accountName || '',
      accountId: account?.accountId || '',
      customUrl: account?.customUrl || '',
    });
  }, [account, defaultPlatformId, fixedPlatformId, form, open]);

  // 自定义链接没有平台账号 ID，但复用 accountName 保存用户填写的链接名称。
  useEffect(() => {
    if (selectedPlatform === 'CustomLink') {
      form.setFieldsValue({
        accountId: '',
      });
      form.setFields([{ name: 'accountId', errors: [], value: '' }]);
    }
  }, [selectedPlatform, form]);

  const handleSubmit = useCallback(async () => {
    if (loading || submittingRef.current) return;

    submittingRef.current = true;
    setSubmitting(true);
    try {
      const values = await form.validateFields();
      values.platformId = fixedPlatformId || values.platformId;
      // 自定义链接平台不需要平台账号 ID，链接名称仍通过 accountName 保存。
      if (values.platformId === 'CustomLink') {
        values.accountId = '';
      }
      await onSubmit(values, account);
    } catch (error) {
      if (!isFormValidationError(error)) {
        message.error(t('saveFailed'));
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [account, fixedPlatformId, form, loading, onSubmit, t]);

  const handleCancel = useCallback(() => {
    if (!isSubmitting) onCancel();
  }, [isSubmitting, onCancel]);

  return (
    <Modal
      title={t(account ? 'editTitle' : 'addTitle')}
      open={open}
      centered
      width={560}
      className={styles.operationFormModal}
      confirmLoading={isSubmitting}
      closable={!isSubmitting}
      maskClosable={!isSubmitting}
      keyboard={!isSubmitting}
      destroyOnHidden
      okText={t('save')}
      cancelText={t('cancel')}
      cancelButtonProps={{ disabled: isSubmitting }}
      onCancel={handleCancel}
      onOk={() => void handleSubmit()}
    >
      <Form<OperationAccountFormValues> form={form} layout="vertical">
        <div className={styles.operationFormGrid}>
          {!fixedPlatformId && (
            <Form.Item
              className={styles.operationFormFull}
              label={t('field.platform')}
              name="platformId"
              rules={[{ required: true, message: t('validation.platformRequired') }]}
            >
              <Radio.Group
                className={styles.operationPlatformTabs}
                optionType="button"
                buttonStyle="solid"
                options={availablePlatformOptions}
                onChange={(e) => setSelectedPlatform(e.target.value)}
              />
            </Form.Item>
          )}
          {selectedPlatform === 'CustomLink' && (
            <>
              <Form.Item
                className={styles.operationFormFull}
                label={t('field.customLinkName')}
                name="accountName"
                rules={[{ required: true, whitespace: true, message: t('validation.customLinkNameRequired') }]}
              >
                <Input placeholder={t('placeholder.customLinkName')} />
              </Form.Item>
              <Form.Item
                className={styles.operationFormFull}
                label={t('field.customUrl')}
                name="customUrl"
                rules={[
                  { required: true, message: t('validation.customUrlRequired') },
                  { type: 'url', message: t('validation.customUrlInvalid') },
                ]}
              >
                <Input placeholder={t('placeholder.customUrl')} />
              </Form.Item>
            </>
          )}
          {selectedPlatform !== 'CustomLink' && (
            <>
              <Form.Item
                className={styles.operationFormHalf}
                label={t('field.accountName')}
                name="accountName"
                rules={[
                  {
                    required: selectedPlatform !== 'CustomLink',
                    whitespace: true,
                    message: t('validation.accountNameRequired'),
                  },
                ]}
              >
                <Input placeholder={t('placeholder.accountName')} />
              </Form.Item>
              <Form.Item
                className={styles.operationFormHalf}
                label={t('field.accountId')}
                name="accountId"
                rules={[
                  {
                    required: selectedPlatform !== 'CustomLink',
                    whitespace: true,
                    message: t('validation.accountIdRequired'),
                  },
                ]}
              >
                <Input placeholder={t('placeholder.accountId')} />
              </Form.Item>
            </>
          )}
        </div>
      </Form>
    </Modal>
  );
};

export default OperationAccountFormModal;
