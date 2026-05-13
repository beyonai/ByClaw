import React, { useCallback, useState } from 'react';
import { Modal, Form, Input } from 'antd';
import { useIntl } from '@umijs/max';
import AntdIcon from '@/components/AntdIcon';
import { EyeInvisibleOutlined, EyeOutlined } from '@ant-design/icons';
import { encryptByRSA } from '@/utils/encrypt/rsa';
import styles from './style.less';

interface CommonLoginModalProps {
  visible: boolean;
  onCancel: () => void;
  publicKey?: string;
  defaultUsername?: string;
  onOk: (params: { username: string; password: string }) => void;
}

interface LoginFormValues {
  username: string;
  password: string;
}

const CommonLoginModal: React.FC<CommonLoginModalProps> = ({ visible, onCancel, publicKey, defaultUsername, onOk }) => {
  const [form] = Form.useForm<LoginFormValues>();
  const intl = useIntl();
  const [confirmLoading, setConfirmLoading] = useState(false);

  const handleOk = async () => {
    setConfirmLoading(true);
    try {
      const values = await form.validateFields();
      const password = await encryptByRSA(values.password, publicKey);
      // 使用RSA加密密码
      onOk({
        ...values,
        password,
      });
    } catch (error) {
      console.error('表单验证或加密失败:', error);
    } finally {
      setConfirmLoading(false);
    }
  };

  const afterOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        form.resetFields();
      }
    },
    [form]
  );

  return (
    <Modal
      centered
      destroyOnHidden
      title={intl.formatMessage({ id: 'login.accountLogin' })}
      open={visible}
      onCancel={onCancel}
      onOk={handleOk}
      confirmLoading={confirmLoading}
      afterOpenChange={afterOpenChange}
      okText={intl.formatMessage({ id: 'common.confirm' })}
      cancelText={intl.formatMessage({ id: 'common.cancel' })}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="username"
          initialValue={defaultUsername}
          label={intl.formatMessage({ id: 'login.account' })}
          rules={[
            {
              required: true,
              message: intl.formatMessage(
                { id: 'form.inputPlaceholder' },
                {
                  content: intl.formatMessage({
                    id: 'login.account',
                  }),
                }
              ),
            },
          ]}
        >
          <Input
            size="large"
            placeholder={intl.formatMessage(
              { id: 'form.inputPlaceholder' },
              {
                content: intl.formatMessage({
                  id: 'login.account',
                }),
              }
            )}
            prefix={<AntdIcon type="icon-a-Useryonghu" className={styles.inputIcon} />}
            onPressEnter={handleOk}
          />
        </Form.Item>

        <Form.Item
          name="password"
          label={intl.formatMessage({ id: 'login.password' })}
          rules={[
            {
              required: true,
              message: intl.formatMessage(
                { id: 'form.inputPlaceholder' },
                {
                  content: intl.formatMessage({
                    id: 'login.password',
                  }),
                }
              ),
            },
          ]}
        >
          <Input.Password
            size="large"
            placeholder={intl.formatMessage(
              { id: 'form.inputPlaceholder' },
              {
                content: intl.formatMessage({
                  id: 'login.password',
                }),
              }
            )}
            prefix={<AntdIcon type="icon-a-Unlockjiesuo" className={styles.inputIcon} />}
            iconRender={(visible) => (visible ? <EyeOutlined /> : <EyeInvisibleOutlined />)}
            onPressEnter={handleOk}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default CommonLoginModal;
