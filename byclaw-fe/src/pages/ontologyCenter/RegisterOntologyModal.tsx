// @ts-nocheck
import React, { useState } from 'react';
import { Form, Input, InputNumber, Modal, Select, TreeSelect, message } from 'antd';
import { useIntl } from '@umijs/max';
import { registerOntologyBase } from '@/service/ontology';

const { TextArea } = Input;

const BASE_ID_REGEX = /^[a-z][a-z0-9_-]{0,15}$/;

/**
 * 本体库注册弹窗：不填外部地址 = LOCAL 自建；填了外部地址 = REMOTE，展开鉴权区。
 */
const RegisterOntologyModal = ({
  open,
  ownerType = 'personal',
  catalogList = [],
  onCancel,
  onSuccess,
}: {
  open: boolean;
  ownerType?: string;
  catalogList?: any[];
  onCancel: () => void;
  onSuccess: () => void;
}) => {
  const intl = useIntl();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const sourceUrl = Form.useWatch('sourceUrl', form);
  const isRemote = !!(sourceUrl && `${sourceUrl}`.trim());

  const handleOk = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      let authConfig;
      if (isRemote && values.authConfig) {
        try {
          authConfig = JSON.parse(values.authConfig);
        } catch {
          message.error(intl.formatMessage({ id: 'ontologyCenter.register.authConfigInvalid' }));
          setSubmitting(false);
          return;
        }
      }
      const res: any = await registerOntologyBase({
        displayName: values.displayName,
        description: values.description,
        baseId: values.baseId || undefined,
        ownerType,
        catalogId: values.catalogId ? Number(values.catalogId) : undefined,
        sourceUrl: isRemote ? `${values.sourceUrl}`.trim() : undefined,
        authType: isRemote ? values.authType : undefined,
        authConfig,
        timeoutSec: isRemote ? values.timeoutSec : undefined,
      });
      if (res && res.code !== undefined && res.code !== 0 && res.code !== 200) {
        message.error(res.msg || res.message || intl.formatMessage({ id: 'common.operationFailed' }));
        return;
      }
      message.success(intl.formatMessage({ id: 'ontologyCenter.register.success' }));
      form.resetFields();
      onSuccess();
    } catch (e: any) {
      if (e?.errorFields) return;
      // request.ts interceptor rejects with a string on HTTP 4xx/5xx; handle both
      const errMsg = typeof e === 'string' ? e : e?.message || intl.formatMessage({ id: 'common.operationFailed' });
      message.error(errMsg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title={intl.formatMessage({ id: 'ontologyCenter.register.title' })}
      okText={intl.formatMessage({ id: 'ontologyCenter.register.submit' })}
      cancelText={intl.formatMessage({ id: 'common.cancel' })}
      confirmLoading={submitting}
      onOk={handleOk}
      onCancel={() => {
        form.resetFields();
        onCancel();
      }}
      destroyOnClose
    >
      <Form form={form} layout="vertical" initialValues={{ authType: 'bearer', timeoutSec: 30 }} preserve={false}>
        <Form.Item
          name="displayName"
          label={intl.formatMessage({ id: 'ontologyCenter.register.displayName' })}
          rules={[
            { required: true, message: intl.formatMessage({ id: 'ontologyCenter.register.displayNameRequired' }) },
          ]}
        >
          <Input maxLength={64} />
        </Form.Item>
        <Form.Item
          name="description"
          label={intl.formatMessage({ id: 'ontologyCenter.register.description' })}
          rules={[
            { required: true, message: intl.formatMessage({ id: 'ontologyCenter.register.descriptionRequired' }) },
          ]}
        >
          <TextArea autoSize={{ minRows: 2, maxRows: 4 }} maxLength={200} />
        </Form.Item>
        <Form.Item
          name="catalogId"
          label={intl.formatMessage({ id: 'ontologyCenter.register.catalog' })}
          rules={[{ required: true, message: intl.formatMessage({ id: 'ontologyCenter.register.catalogRequired' }) }]}
        >
          <TreeSelect
            allowClear
            showSearch
            treeNodeFilterProp="title"
            placeholder={intl.formatMessage({ id: 'ontologyCenter.register.catalogPlaceholder' })}
            treeData={catalogList}
            fieldNames={{ label: 'catalogName', value: 'catalogId', children: 'children' }}
            treeDefaultExpandAll
          />
        </Form.Item>
        <Form.Item
          name="baseId"
          label={intl.formatMessage({ id: 'ontologyCenter.register.baseId' })}
          extra={intl.formatMessage({ id: 'ontologyCenter.register.baseIdTip' })}
          rules={[
            {
              validator: (_, value) =>
                !value || BASE_ID_REGEX.test(value)
                  ? Promise.resolve()
                  : Promise.reject(new Error(intl.formatMessage({ id: 'ontologyCenter.register.baseIdInvalid' }))),
            },
          ]}
        >
          <Input placeholder="crm_demo" />
        </Form.Item>
        <Form.Item
          name="sourceUrl"
          label={intl.formatMessage({ id: 'ontologyCenter.register.sourceUrl' })}
          extra={intl.formatMessage({ id: 'ontologyCenter.register.sourceUrlTip' })}
        >
          <Input placeholder="https://host:port/DtStudio/daiservice" />
        </Form.Item>
        {isRemote && (
          <>
            <Form.Item name="authType" label={intl.formatMessage({ id: 'ontologyCenter.register.authType' })}>
              <Select
                options={[
                  { value: 'none', label: 'none' },
                  { value: 'api_key', label: 'api_key' },
                  { value: 'bearer', label: 'bearer' },
                  { value: 'oauth2', label: 'oauth2' },
                ]}
              />
            </Form.Item>
            <Form.Item name="authConfig" label={intl.formatMessage({ id: 'ontologyCenter.register.authConfig' })}>
              <TextArea
                autoSize={{ minRows: 2, maxRows: 4 }}
                placeholder='{"header":"Authorization","value":"Bearer ..."}'
              />
            </Form.Item>
            <Form.Item name="timeoutSec" label={intl.formatMessage({ id: 'ontologyCenter.register.timeoutSec' })}>
              <InputNumber min={1} max={600} style={{ width: '100%' }} />
            </Form.Item>
          </>
        )}
      </Form>
    </Modal>
  );
};

export default RegisterOntologyModal;
