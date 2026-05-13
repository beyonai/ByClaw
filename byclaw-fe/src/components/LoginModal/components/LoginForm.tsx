import AntdIcon from '@/components/AntdIcon';
import { useIntl } from '@umijs/max';
import { EyeInvisibleOutlined, EyeOutlined } from '@ant-design/icons';

import type { FormInstance } from 'antd';
import { Button, Form, Input, message } from 'antd';
import { useState } from 'react';

import { encryptByAES } from '@/utils/encrypt/aes';
import { encryptBySM } from '@/utils/encrypt/sm';

import styles from '../index.module.less';

type IProps = {
  onLogin: (param: any) => Promise<any>;
  form: FormInstance;
};

function LoginForm({ form, onLogin }: IProps) {
  const intl = useIntl();

  const [loginLoading, setLoginLoading] = useState(false);

  // 处理登录
  const handleLogin = async () => {
    try {
      const values = await form.validateFields(['accountCode', 'accountPwd']);
      if (values) {
        const loginType = '5';

        const params = {
          accountCode: encryptByAES(values.accountCode),
          accountPwd: encryptBySM(values.accountPwd),
          loginType,
          encrypt: 2,
        };

        setLoginLoading(true);
        onLogin(params).finally(() => {
          setLoginLoading(false);
        });
      }
    } catch (error) {
      message.warning(intl.formatMessage({ id: 'login.validationFailed' }));
    }
  };

  return (
    <Form form={form} name="login_account" layout="vertical">
      <Form.Item
        name="accountCode"
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
          onPressEnter={handleLogin}
        />
      </Form.Item>

      <Form.Item
        name="accountPwd"
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
          onPressEnter={handleLogin}
        />
      </Form.Item>
      <Button
        type="primary"
        size="large"
        block
        onClick={handleLogin}
        loading={loginLoading}
        style={{ marginBottom: 12 }}
      >
        {intl.formatMessage({ id: 'login.loginNow' })}
      </Button>
    </Form>
  );
}
export default LoginForm;
