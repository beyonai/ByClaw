// tslint:disable:ordered-imports
import React from 'react';

import { Form, Input, Space } from 'antd';
import { useIntl } from '@umijs/max';

import CaptchaInput from '@/components/Captchainput/byApi';
import SMSInput from '@/components/SMSInput';

import styles from '../index.module.less';

function RegForm({ form, CaptchaInputRef }: { form: any; CaptchaInputRef: any }) {
  const intl = useIntl();

  const checkCaptchaInput = React.useCallback(async () => {
    const { regCode: regCodeVal } = await form.getFieldsValue(['regCode']);

    const regCodeRes = CaptchaInputRef.current?.validate?.(regCodeVal);
    if (!regCodeRes || !regCodeVal) {
      form.setFields([
        {
          name: ['regCode'],
          errors: [intl.formatMessage({ id: 'login.captchaInvalid' })],
        },
      ]);

      return false;
    }

    return regCodeVal;
  }, [form]);

  const checkPhoneInput = React.useCallback(async () => {
    const values = await form.validateFields(['regPhone']);

    return values.regPhone;
  }, []);

  return (
    <>
      <h2 className={styles.title} style={{ marginBottom: 48 }}>
        {intl.formatMessage({ id: 'login.registerForFreeTrial' })}
      </h2>

      <Form form={form} name="regAccount" layout="vertical">
        <Form.Item
          name="regPhone"
          rules={[
            {
              required: true,
              message: intl.formatMessage(
                { id: 'form.inputPlaceholder' },
                {
                  content: intl.formatMessage({ id: 'login.phone' }),
                }
              ),
            },
            {
              pattern: /^1[3-9]\d{9}$/, // 手机号正则表达式
              message: intl.formatMessage({ id: 'login.phoneFormatInvalid' }), // 格式错误提示
            },
          ]}
        >
          <Input
            addonBefore={<span style={{ fontSize: '14px' }}>+86</span>}
            placeholder={intl.formatMessage({ id: 'login.enterPhone' })}
            allowClear
            size="large"
            className={styles.inputWithAddonBefore}
          />
        </Form.Item>
        <Form.Item
          name="regCode"
          rules={[
            {
              required: true,
              message: intl.formatMessage(
                { id: 'form.inputPlaceholder' },
                {
                  content: intl.formatMessage({ id: 'login.verificationCode' }),
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
          name="regSmscode"
          rules={[
            {
              required: true,
              message: intl.formatMessage(
                { id: 'form.inputPlaceholder' },
                {
                  content: intl.formatMessage({ id: 'login.smsCode' }),
                }
              ),
            },
          ]}
        >
          <Space.Compact style={{ width: '100%' }}>
            <Input
              size="large"
              addonAfter={
                <SMSInput
                  checkCaptchaInput={checkCaptchaInput}
                  checkPhoneInput={checkPhoneInput}
                  bizType="2"
                />
              }
              className={styles.inputWithAddonAfter}
              placeholder={intl.formatMessage({ id: 'login.enterSmsCode' })}
            />
          </Space.Compact>
        </Form.Item>
      </Form>
    </>
  );
}
export default RegForm;
