import AntdIcon from '@/components/AntdIcon';
import { useIntl } from '@umijs/max';
import type { FormInstance } from 'antd';
import { Button, Form, Input, message, Space } from 'antd';
import React, { useState } from 'react';

import { encryptByAES } from '@/utils/encrypt/aes';
import SMSInput from '@/components/SMSInput';
import CaptchaInput from '@/components/Captchainput/byApi';

import styles from '../index.module.less';

type IProps = {
  onLogin: (param: any) => Promise<any>;
  form: FormInstance;
};

function PhoneLoginForm({ form, onLogin }: IProps) {
  const intl = useIntl();

  const [loginLoading, setLoginLoading] = useState(false);

  const CaptchaInputRef = React.useRef<any>(null);

  const checkCaptchaInput = React.useCallback(async () => {
    const { loginRegCode: regCodeVal } = await form.getFieldsValue(['loginRegCode']);

    const regCodeRes = CaptchaInputRef.current?.validate?.(regCodeVal);

    if (!regCodeRes || !regCodeVal) {
      form.setFields([
        {
          name: ['loginRegCode'],
          errors: [intl.formatMessage({ id: 'login.captchaInvalid' })],
        },
      ]);

      return false;
    }

    return regCodeVal;
  }, [form]);

  // 处理登录
  const handleLogin = async () => {
    try {
      const values = await form.validateFields(['loginPhone', 'loginCode', 'loginRegCode']);
      if (values) {
        const loginType = '4';

        const params = {
          phone: encryptByAES(values.loginPhone),
          verifyCode: values.loginCode,
          // captcha: values.loginRegCode,
          loginType,
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

  const checkPhoneInput = React.useCallback(async () => {
    const values = await form.validateFields(['loginPhone']);
    return values.loginPhone;
  }, []);

  return (
    <Form form={form} name="login_phone" layout="vertical" className={styles.phoneFormContent}>
      <Form.Item
        name="loginPhone"
        rules={[
          {
            required: true,
            message: intl.formatMessage(
              { id: 'form.inputPlaceholder' },
              {
                content: intl.formatMessage({
                  id: 'login.phone',
                }),
              }
            ),
          },
          {
            pattern: /^1\d{10}$/,
            message: intl.formatMessage({
              id: 'login.phoneInvalid',
            }),
          },
        ]}
      >
        <Input
          size="large"
          placeholder={intl.formatMessage(
            { id: 'form.inputPlaceholder' },
            {
              content: intl.formatMessage({
                id: 'login.phone',
              }),
            }
          )}
          prefix={<AntdIcon type="icon-a-Iphonepingguoshouji" className={styles.inputIcon} />}
        />
      </Form.Item>

      <Form.Item
        name="loginRegCode"
        rules={[
          {
            required: true,
            message: intl.formatMessage(
              { id: 'form.inputPlaceholder' },
              {
                content: intl.formatMessage({ id: 'login.captcha' }),
              }
            ),
          },
        ]}
      >
        <Input
          addonAfter={
            <div style={{ width: '85px' }}>
              <CaptchaInput ref={CaptchaInputRef} />
            </div>
          }
          size="large"
          className={styles.inputWithAddonAfter}
          placeholder={intl.formatMessage({ id: 'login.enterCaptcha' })}
        />
      </Form.Item>

      <Form.Item
        name="loginCode"
        rules={[
          {
            required: true,
            message: intl.formatMessage(
              { id: 'form.inputPlaceholder' },
              {
                content: intl.formatMessage({
                  id: 'login.verificationCode',
                }),
              }
            ),
          },
        ]}
      >
        <Space.Compact style={{ width: '100%' }}>
          <Input
            size="large"
            addonAfter={
              <SMSInput checkCaptchaInput={checkCaptchaInput} checkPhoneInput={checkPhoneInput} bizType="1" />
            }
            className={styles.inputWithAddonAfter}
            placeholder={intl.formatMessage({ id: 'login.enterSmsCode' })}
          />
        </Space.Compact>
      </Form.Item>

      <Button
        size="large"
        block
        type="primary"
        onClick={handleLogin}
        loading={loginLoading}
        style={{ marginBottom: 12 }}
      >
        {intl.formatMessage({ id: 'login.loginNow' })}
      </Button>
    </Form>
  );
}

export default PhoneLoginForm;
