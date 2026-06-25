import React, { useEffect, useState } from 'react';
import { Modal, Form, InputNumber, message, Spin } from 'antd';
import { useIntl, connect } from '@umijs/max';

const TokenQuotaModal = ({ visible, record, onCancel, onOk, dispatch }) => {
  const intl = useIntl();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (visible && record?.userId) {
      setFetching(true);
      dispatch({
        type: 'memberMgr/getTokenQuota',
        payload: { userId: record.userId },
        success: (res) => {
          const data = res?.data;
          const quota = data?.quota;
          const systemDefault = data?.systemDefault;
          if (quota && quota.monthlyQuotaLimit !== null) {
            form.setFieldsValue({ monthlyQuotaLimit: quota.monthlyQuotaLimit });
          } else if (systemDefault !== null) {
            form.setFieldsValue({ monthlyQuotaLimit: systemDefault });
          } else {
            form.resetFields();
          }
          setFetching(false);
        },
        fail: () => {
          form.resetFields();
          setFetching(false);
        },
      });
    } else {
      form.resetFields();
    }
  }, [visible, record]);

  const handleOk = () => {
    form.validateFields().then((values) => {
      setLoading(true);
      dispatch({
        type: 'memberMgr/assignTokenQuota',
        payload: {
          userId: record.userId,
          monthlyQuotaLimit: values.monthlyQuotaLimit,
        },
        success: () => {
          message.success(intl.formatMessage({ id: 'orgMgr.members.assignTokenQuota.success' }));
          setLoading(false);
          onOk?.();
        },
        fail: (res) => {
          message.error(res?.msg || 'Failed');
          setLoading(false);
        },
      });
    });
  };

  return (
    <Modal
      title={intl.formatMessage({ id: 'orgMgr.members.assignTokenQuota.title' })}
      open={visible}
      onCancel={onCancel}
      onOk={handleOk}
      confirmLoading={loading}
      destroyOnClose
    >
      <Spin spinning={fetching}>
        <Form form={form} layout="vertical">
          <Form.Item
            name="monthlyQuotaLimit"
            label={intl.formatMessage({ id: 'orgMgr.members.assignTokenQuota.label' })}
            rules={[
              {
                required: true,
                message: intl.formatMessage({ id: 'orgMgr.members.assignTokenQuota.placeholder' }),
              },
            ]}
          >
            <InputNumber
              min={0}
              step={100000}
              style={{ width: '100%' }}
              placeholder={intl.formatMessage({ id: 'orgMgr.members.assignTokenQuota.placeholder' })}
            />
          </Form.Item>
          <div style={{ fontSize: 12, color: '#999' }}>
            {intl.formatMessage({ id: 'orgMgr.members.assignTokenQuota.hint' })}
          </div>
        </Form>
      </Spin>
    </Modal>
  );
};

export default connect()(TokenQuotaModal);
