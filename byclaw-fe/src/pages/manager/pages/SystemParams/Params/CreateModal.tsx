import { Form, Input, message, Modal } from 'antd';
import classNames from 'classnames';
import React, { useEffect } from 'react';
import { useIntl } from '@umijs/max';

import { saveSystemConfig, updateSystemConfig } from '@/pages/manager/service/System';
import styles from './index.module.less';
import UploadPolicyEditor from './UploadPolicyFields';
import { UPLOAD_CONFIG_CODE, getUploadPolicyFields, mergeUploadPolicyFields } from './uploadPolicy';

type SystemParamsItem = {
  paramCode: string;
  paramName: string;
  paramEnName: string;
  paramValue: string;
  paramDesc: string;
};

const CreateModal = (props: {
  open: boolean;
  onClose: () => void;
  onSuccess: (isEdit: boolean) => void;
  record: SystemParamsItem | null;
}) => {
  const { open, onClose, onSuccess, record } = props;
  const intl = useIntl();
  const [form] = Form.useForm();
  const paramCode = Form.useWatch('paramCode', form);
  const paramValue = Form.useWatch('paramValue', form) || '';

  const [confirmLoading, setConfirmLoading] = React.useState(false);

  const isEdit = !!record;

  const onOk = () => {
    form
      .validateFields()
      .then((values) => {
        if (values.paramCode === UPLOAD_CONFIG_CODE) {
          values.paramValue = mergeUploadPolicyFields(values.paramValue, getUploadPolicyFields(values.paramValue));
        }
        setConfirmLoading(true);

        const fn = isEdit ? updateSystemConfig : saveSystemConfig;
        let p = values;
        if (isEdit) p = { ...record, ...values };

        fn(p)
          .then((res) => {
            if (res.code === 0) {
              message.success(res.msg);
              onSuccess(isEdit);
            } else {
              message.error(res.msg);
            }
          })
          .finally(() => {
            setConfirmLoading(false);
          });
      })
      .catch((error) => {
        console.error('Validation failed:', error);
      });
  };

  const onCancel = () => {
    form.resetFields();
    onClose();
  };

  useEffect(() => {
    if (!open) {
      form.resetFields();
      return;
    }
    if (record) {
      const { paramValue, ...rest } = record as any;
      // CodeMirror 要求 value 为 string，这里兼容对象/数组等情况
      let stringValue = '';
      if (typeof paramValue === 'string') stringValue = paramValue;
      else if (paramValue !== null && paramValue !== undefined) stringValue = JSON.stringify(paramValue, null, 2);

      form.setFieldsValue({
        ...rest,
        paramValue: stringValue,
      });
    }
  }, [open, record]);

  return (
    <Modal
      title={
        isEdit
          ? intl.formatMessage({ id: 'SystemParams.createModal.editTitle' })
          : intl.formatMessage({ id: 'SystemParams.createModal.addTitle' })
      }
      open={open}
      onOk={onOk}
      onCancel={onCancel}
      confirmLoading={confirmLoading}
      width={'80vw'}
      centered
    >
      <Form form={form} layout="vertical">
        <div className="ub gap12">
          <div className={classNames(styles.left, 'ub-f1')}>
            <Form.Item
              label={intl.formatMessage({ id: 'SystemParams.createModal.paramName' })}
              name="paramName"
              rules={[
                {
                  required: true,
                  message: intl.formatMessage({ id: 'SystemParams.createModal.paramNamePlaceholder' }),
                },
              ]}
            >
              <Input />
            </Form.Item>
            <Form.Item
              label={intl.formatMessage({ id: 'SystemParams.createModal.paramCode' })}
              name="paramCode"
              rules={[
                {
                  required: true,
                  message: intl.formatMessage({ id: 'SystemParams.createModal.paramCodePlaceholder' }),
                },
              ]}
            >
              <Input disabled={isEdit} />
            </Form.Item>
            <Form.Item
              label={intl.formatMessage({ id: 'SystemParams.createModal.paramEnName' })}
              name="paramEnName"
              rules={[
                {
                  required: true,
                  message: intl.formatMessage({ id: 'SystemParams.createModal.paramEnNamePlaceholder' }),
                },
              ]}
            >
              <Input />
            </Form.Item>
            <Form.Item label={intl.formatMessage({ id: 'SystemParams.createModal.paramDesc' })} name="paramDesc">
              <Input.TextArea rows={5} style={{ resize: 'none' }} />
            </Form.Item>
          </div>
          <div className={classNames(styles.right, 'ub-f1')}>
            {paramCode === UPLOAD_CONFIG_CODE && (
              <UploadPolicyEditor value={paramValue} onChange={(next) => form.setFieldsValue({ paramValue: next })} />
            )}
            <Form.Item
              label={intl.formatMessage({ id: 'SystemParams.createModal.paramValue' })}
              name="paramValue"
              className={styles.paramValue}
              rules={[
                {
                  validator: async (_, value) => {
                    if (form.getFieldValue('paramCode') === UPLOAD_CONFIG_CODE) getUploadPolicyFields(value);
                  },
                },
              ]}
            >
              <Input.TextArea rows={20} style={{ fontFamily: 'monospace', resize: 'none', minHeight: 500 }} />
            </Form.Item>
          </div>
        </div>
      </Form>
    </Modal>
  );
};

export default CreateModal;
