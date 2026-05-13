import React from 'react';
import classNames from 'classnames';
import { Form, Input, Button, message, Divider, Tabs, Space } from 'antd';
import { useIntl, useDispatch, useNavigate } from '@umijs/max';

import { getPublicPath, getRootPagePath } from '@/utils';
import { getSystemConfigByStorage } from '@/utils/system';

import CaptchaInput from '@/components/Captchainput/byApi';
import AntdIcon from '@/components/AntdIcon';
import SMSInput from '@/components/SMSInput';

import { loginByUsername, loginByPhone } from '@/service/user';

import { encryptByAES } from '@/utils/encrypt/aes';
import { encryptBySM } from '@/utils/encrypt/sm';

import styles from './index.module.less';

export default function Login() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [form] = Form.useForm();

  const intl = useIntl();

  const [loginLoading, setLoginLoading] = React.useState(false);
  const [loginType, setLoginType] = React.useState('account');

  const CaptchaInputRef = React.useRef(null);

  const getAssistantIcon = React.useMemo(() => {
    const defaultIcon = `${getPublicPath()}beyond/logo256.svg`;
    return getSystemConfigByStorage().assistant || defaultIcon;
  }, []);

  const setUserInfo = React.useCallback(
    (res: any) => {
      dispatch({
        type: 'user/setUserInfo',
        payload: {
          ...res,
        },
      });
    },
    [dispatch]
  );

  const onAccountLogin = React.useCallback(() => {
    form.validateFields().then((values) => {
      const loginType = '5';

      const params = {
        accountCode: encryptByAES(values.accountCode),
        accountPwd: encryptBySM(values.accountPwd),
        loginType,
        encrypt: 2,
      };

      setLoginLoading(true);
      loginByUsername(params)
        .then((res) => {
          if (!res || res.code !== 0) {
            message.error(res?.msg || 'Login failed');
            return;
          }
          message.success(intl.formatMessage({ id: 'login.success' }));

          setUserInfo(res);
          navigate(getRootPagePath());
        })
        .catch((e) => {
          message.error(e || 'Login failed');
        })
        .finally(() => {
          setLoginLoading(false);
        });
    });
  }, []);

  const onPhoneLogin = async () => {
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
        loginByPhone(params)
          .then((res) => {
            if (!res) {
              message.error('登录失败');
              return;
            }
            message.success(intl.formatMessage({ id: 'login.success' }));

            setUserInfo(res);
            navigate(getRootPagePath());
          })
          .catch(() => {
            message.error('登录失败');
          })
          .finally(() => {
            setLoginLoading(false);
          });
      }
    } catch (error) {
      message.warning(intl.formatMessage({ id: 'login.validationFailed' }));
    }
  };

  const checkCaptchaInput = React.useCallback(async () => {
    const { loginRegCode: regCodeVal } = await form.getFieldsValue(['loginRegCode']);

    const regCodeRes = CaptchaInputRef.current?.validate?.(regCodeVal);

    if (!regCodeRes || !regCodeVal) {
      form.setFields([
        {
          name: ['loginRegCode'],
          errors: ['请输入正确的图形验证码'],
        },
      ]);

      return false;
    }

    return regCodeVal;
  }, [form]);

  const checkPhoneInput = React.useCallback(async () => {
    const values = await form.validateFields(['loginPhone']);
    return values.loginPhone;
  }, []);

  return (
    <div
      className={classNames('full-height full-width', styles.loginWrapper)}
      style={{ backgroundImage: `url(${getPublicPath()}beyond/mobile/loginBg.png)` }}
    >
      <div className={classNames(styles.header, 'ub ub-ac ub-pc ub-ver gap12')}>
        <div className={styles.logo}>
          <img alt="assistant" src={getAssistantIcon} className={classNames(styles.assistant)} />
        </div>
        <p className={styles.title}>
          {getSystemConfigByStorage().title || intl.formatMessage({ id: 'messageList.defaultAIName' })}
        </p>
      </div>

      <div className={styles.form}>
        <Form form={form} layout="vertical">
          <Tabs
            activeKey={loginType}
            onChange={(key) => setLoginType(key as 'account' | 'phone')}
            tabBarStyle={{ display: 'none' }}
          >
            <Tabs.TabPane key="account" tab="帐号密码登录">
              <Form.Item name="accountCode" rules={[{ required: true, message: '请输入账号' }]}>
                <Input size="large" placeholder="请输入账号" />
              </Form.Item>
              <Form.Item name="accountPwd" rules={[{ required: true, message: '请输入密码' }]}>
                <Input.Password size="large" placeholder="请输入密码" />
              </Form.Item>
            </Tabs.TabPane>
            <Tabs.TabPane key="phone" tab="手机号登录">
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
                        content: '图形验证码',
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
                  placeholder="请输入验证码"
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
                    placeholder="请输入短信验证码"
                  />
                </Space.Compact>
              </Form.Item>
            </Tabs.TabPane>
          </Tabs>
        </Form>
      </div>

      <div className={styles.loginButton}>
        <Button
          type="primary"
          size="large"
          block
          onClick={() => {
            if (loginType === 'account') {
              onAccountLogin();
            }
            if (loginType === 'phone') {
              onPhoneLogin();
            }
          }}
          loading={loginLoading}
        >
          立即登录
        </Button>
        <div className={classNames(styles.loginButtonGroup, 'ub ub-ac ub-pc gap8')}>
          <span
            className={classNames({ [styles.active]: loginType === 'account' })}
            onClick={() => setLoginType('account')}
          >
            帐号密码登录
          </span>
          <Divider type="vertical" />
          <span
            className={classNames({ [styles.active]: loginType === 'phone' })}
            onClick={() => setLoginType('phone')}
          >
            手机号登录
          </span>
        </div>
      </div>
    </div>
  );
}
