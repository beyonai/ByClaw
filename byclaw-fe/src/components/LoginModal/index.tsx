// tslint:disable:ordered-imports
import React, { useCallback, useEffect, useState } from 'react';

import { Button, Checkbox, Form, message, Modal, Spin, Tabs, ConfigProvider } from 'antd';
import classNames from 'classnames';
// @ts-ignore
import { getLocale, setLocale, useDispatch, useIntl } from '@umijs/max';

import { loginByUsername, registerByPhone, loginByPhone } from '@/service/user';

import { getPublicPath } from '@/utils';

import { encryptByAES } from '@/utils/encrypt/aes';

import useAppStore from '@/models/common/useAppStore';

import RegForm from './components/RegForm';
import LoginForm from './components/LoginForm';
import PhoneLoginForm from './components/PhoneLoginForm';

import { getSSOUrl } from '@/service/auth';
// import AntdIcon from '../AntdIcon';
import styles from './index.module.less';

type LoginChannel = 'account' | 'phone' | 'dingtalk' | 'iwhale';

interface LoginModalProps {
  open: boolean;
  onClose: () => void;
  className?: string;
  defaultRegister?: boolean;
}

const LoginModal: React.FC<LoginModalProps> = ({ open, onClose, className, defaultRegister = false }) => {
  const dispatch = useDispatch();
  const { ENV } = useAppStore();

  const [loginChannel, setLoginChannel] = useState<LoginChannel>('account');
  const [isAgreed, setIsAgreed] = useState(() => {
    const agreed = localStorage.getItem('isAgreed');
    return `${agreed}` === '1';
  });
  const [regLoading, setRegLoading] = useState(false);
  const [getSSOUrlLoading, setgetSSOUrlLoading] = useState(false);
  const [isRegister, setIsregistered] = useState(defaultRegister);

  const CaptchaInputRef = React.useRef(null);
  const AbortControllerRef = React.useRef<AbortController>(null);

  const intl = useIntl();

  const [form] = Form.useForm();

  const isSSOLogin = ['dingtalk', 'iwhale'].includes(loginChannel);
  const canRegister = (ENV || []).includes('yunqi');
  const termsUrl = React.useMemo(() => `${getPublicPath()}legal/terms/index.html`, []);
  const privacyUrl = React.useMemo(() => `${getPublicPath()}legal/privacy/index.html`, []);

  const handleLegalLinkClick = React.useCallback((e: React.MouseEvent<HTMLAnchorElement>) => {
    e.stopPropagation();
  }, []);

  const setUserInfo = useCallback(
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

  // 处理协议同意
  const handleAgreementCheck = React.useCallback(
    (checked: boolean) => {
      setIsAgreed(checked);
      if (checked) {
        localStorage.setItem('isAgreed', '1');
      } else {
        localStorage.removeItem('isAgreed');
      }
    },
    [isAgreed]
  );

  // 检查协议是否同意
  const checkAgreement = React.useCallback(() => {
    if (!isAgreed) {
      Modal.confirm({
        title: intl.formatMessage({ id: 'login.agreementTitle' }),
        content: (
          <div className={styles.agreement}>
            {intl.formatMessage({ id: 'login.agreementPrefix' })}
            <a href={termsUrl} target="_blank" rel="noreferrer" onClick={handleLegalLinkClick}>
              {intl.formatMessage({ id: 'login.termsOfService' })}
            </a>
            {intl.formatMessage({ id: 'login.and' })}
            <a href={privacyUrl} target="_blank" rel="noreferrer" onClick={handleLegalLinkClick}>
              {intl.formatMessage({ id: 'login.privacyPolicy' })}
            </a>
          </div>
        ),
        onOk: () => {
          handleAgreementCheck(true);
        },
      });
      return false;
    }
    return true;
  }, [intl, isAgreed, termsUrl, privacyUrl, handleLegalLinkClick]);

  const handleResponse = React.useCallback(
    (res: any) => {
      if (!res) return;
      setUserInfo(res);

      if (!localStorage.getItem('isAgreed')) {
        localStorage.setItem('isAgreed', '1');
      }

      // 外籍人员自动切换英文
      if (res?.data.userStation?.isAbroad === 1 && ['zh', 'zh-CN'].includes(getLocale())) {
        setLocale('en-US');
      }

      onClose();
    },
    [intl, setUserInfo, onClose]
  );

  const onLogin = useCallback(
    (params: any) => {
      if (!checkAgreement()) return Promise.reject();

      AbortControllerRef.current = new AbortController();

      return loginByUsername(params, AbortControllerRef.current)
        .then((res) => {
          console.log(res);
          if (!res || res.code !== 0) {
            message.error(res?.msg || 'Login failed');
            return;
          }

          handleResponse(res);

          message.success(intl.formatMessage({ id: 'login.success' }));
        })
        .catch((e) => {
          message.error(e || 'Login failed');
        });
    },
    [intl, setUserInfo, checkAgreement]
  );

  const onPhoneLogin = useCallback(
    (params: any) => {
      if (!checkAgreement()) return Promise.reject();

      AbortControllerRef.current = new AbortController();

      return loginByPhone(params, AbortControllerRef.current)
        .then((res) => {
          handleResponse(res);

          message.success(intl.formatMessage({ id: 'login.success' }));
        })
        .catch((e) => {
          console.error(e);
        });
    },
    [intl, checkAgreement]
  );

  const onRegister = useCallback((params: any) => {
    setRegLoading(true);

    AbortControllerRef.current = new AbortController();

    return registerByPhone(params, AbortControllerRef.current)
      .then((res) => {
        handleResponse(res);
        message.success(intl.formatMessage({ id: 'login.registerSuccess' }));
      })
      .catch((e) => {
        console.error(e);
      })
      .finally(() => {
        setRegLoading(false);
      });
  }, []);

  const handleReg = async () => {
    if (!checkAgreement()) return Promise.reject();

    try {
      const values = await form.validateFields(['regPhone', 'regSmscode', 'regCode']);
      const { regPhone, regSmscode } = values;

      return onRegister({
        phone: encryptByAES(regPhone),
        verifyCode: regSmscode,
      });
    } catch (error) {
      message.warning(intl.formatMessage({ id: 'login.validationFailed' }));
    }

    return Promise.reject();
  };

  // 切换登录方式
  const handleLoginTypeChange = (type: LoginChannel) => {
    form.resetFields();

    setLoginChannel(type);

    if (['dingtalk', 'iwhale'].includes(type)) {
      if (getSSOUrlLoading) return;

      setgetSSOUrlLoading(true);

      getSSOUrl(type)
        .then((res) => {
          if (`${res.code}` === '0') {
            setLoginChannel((prevState) => {
              if (type === prevState) {
                window.location.href = res.data;
              }

              return prevState;
            });
          } else {
            message.error(res.msg);
          }
        })
        .catch(() => {
          message.error(intl.formatMessage({ id: 'common.networkError' }));
        })
        .finally(() => {
          setgetSSOUrlLoading(false);
        });
    }
  };

  const LoginRenderer = React.useCallback(() => {
    return (
      <>
        <h2 className={styles.title}>{intl.formatMessage({ id: 'login.title' })}</h2>

        <div style={{ minHeight: 313 }}>
          <div
            className={classNames(styles.loginContent, {
              [styles.phone]: loginChannel === 'phone',
              [styles.whale]: isSSOLogin,
            })}
          >
            {['account', 'phone'].includes(loginChannel) && (
              <ConfigProvider
                theme={{
                  components: {
                    Tabs: {
                      itemSelectedColor: '#165dff',
                      itemHoverColor: 'rgba(22, 93, 255, .8)',
                      inkBarColor: '#165dff',
                      titleFontSize: 16,
                    },
                  },
                }}
              >
                <Tabs
                  activeKey={loginChannel}
                  className={styles.tabs}
                  onChange={(key) => handleLoginTypeChange(key as 'account' | 'phone')}
                >
                  {canRegister && (
                    <Tabs.TabPane key="phone" tab={intl.formatMessage({ id: 'login.phoneLogin' })}>
                      <PhoneLoginForm form={form} onLogin={onPhoneLogin} />
                    </Tabs.TabPane>
                  )}
                  <Tabs.TabPane key="account" tab={intl.formatMessage({ id: 'login.accountLogin' })}>
                    <LoginForm form={form} onLogin={onLogin} />
                  </Tabs.TabPane>
                </Tabs>
              </ConfigProvider>
            )}
            {['dingtalk', 'iwhale'].includes(loginChannel) && <Spin spinning />}
          </div>

          <div className={styles.agreement}>
            <Checkbox checked={isAgreed} onChange={(e) => handleAgreementCheck(e.target.checked)}>
              {intl.formatMessage({ id: 'login.agreementPrefix' })}
              <a href={termsUrl} target="_blank" rel="noreferrer" onClick={handleLegalLinkClick}>
                {intl.formatMessage({ id: 'login.termsOfService' })}
              </a>
              {intl.formatMessage({ id: 'login.and' })}
              <a href={privacyUrl} target="_blank" rel="noreferrer" onClick={handleLegalLinkClick}>
                {intl.formatMessage({ id: 'login.privacyPolicy' })}
              </a>
            </Checkbox>
          </div>
        </div>

        {/* {!canRegister && (
          <div className={styles.otherLoginWays} style={{ marginTop: 'auto' }}>
            <Divider className={styles.divider} plain>
              {intl.formatMessage({ id: 'login.otherLoginMethods' })}
            </Divider>
            <div className={styles.socialIcons}>
              {loginChannel !== 'account' && loginChannel !== 'phone' && (
                <Tooltip title={intl.formatMessage({ id: 'login.accountLogin' })}>
                  <Button
                    style={{ width: 32, height: 32 }}
                    shape="circle"
                    icon={<AntdIcon type="icon-zhanghaomima" style={{ fontSize: '32px' }} />}
                    size="small"
                    onClick={() => handleLoginTypeChange('account')}
                  />
                </Tooltip>
              )}
              <Tooltip title={intl.formatMessage({ id: 'login.dingtalkLogin' })}>
                <Button
                  style={{ width: 32, height: 32 }}
                  shape="circle"
                  icon={<AntdIcon type="icon-dingding" style={{ fontSize: '32px' }} />}
                  size="small"
                  onClick={() => handleLoginTypeChange('dingtalk')}
                />
              </Tooltip>
              <Tooltip title={intl.formatMessage({ id: 'login.whaleLogin' })}>
                <Button
                  style={{ width: 32, height: 32 }}
                  shape="circle"
                  size="small"
                  onClick={() => handleLoginTypeChange('iwhale')}
                >
                  <img
                    src={`${getPublicPath()}beyond/jingjia.png`}
                    style={{ width: '32px', height: '32px' }}
                    alt="jingjia"
                    // eslint-disable-next-line react/no-unknown-property
                    fetchPriority="low"
                  />
                </Button>
              </Tooltip>
            </div>
          </div>
        )} */}

        {canRegister && (
          <p className="ub ub-ac ub-pc" style={{ marginTop: 'auto', fontSize: 13 }}>
            {intl.formatMessage({ id: 'login.noAccount' })}
            <span
              className="pointer"
              onClick={() => {
                setIsregistered(true);
              }}
              style={{ color: 'var(--beyond-color-primary)' }}
            >
              {intl.formatMessage({ id: 'login.registerNow' })}
            </span>
          </p>
        )}
      </>
    );
  }, [
    intl,
    loginChannel,
    isSSOLogin,
    form,
    onLogin,
    onPhoneLogin,
    canRegister,
    isAgreed,
    termsUrl,
    privacyUrl,
    handleLegalLinkClick,
    handleAgreementCheck,
  ]);

  const RegisteredRenderer = React.useCallback(() => {
    return (
      <>
        <RegForm form={form} CaptchaInputRef={CaptchaInputRef} />
        <div className={styles.agreement}>
          <Checkbox checked={isAgreed} onChange={(e) => handleAgreementCheck(e.target.checked)}>
            {intl.formatMessage({ id: 'login.agreementPrefix' })}
            <a href={termsUrl} target="_blank" rel="noreferrer" onClick={handleLegalLinkClick}>
              {intl.formatMessage({ id: 'login.termsOfService' })}
            </a>
            {intl.formatMessage({ id: 'login.and' })}
            <a href={privacyUrl} target="_blank" rel="noreferrer" onClick={handleLegalLinkClick}>
              {intl.formatMessage({ id: 'login.privacyPolicy' })}
            </a>
          </Checkbox>
        </div>

        <div style={{ marginTop: '12px' }} className={styles.loginButton}>
          <Button type="primary" size="large" block onClick={handleReg} loading={regLoading}>
            {intl.formatMessage({ id: 'login.registerNow' })}
          </Button>
        </div>

        <p className="ub ub-ac ub-pc" style={{ marginTop: 'auto', fontSize: 13 }}>
          {intl.formatMessage({ id: 'login.hasAccount' })}
          <span
            className="pointer"
            onClick={() => {
              setIsregistered(false);
            }}
            style={{ color: 'var(--beyond-color-primary)' }}
          >
            {intl.formatMessage({ id: 'login.loginNow' })}
          </span>
        </p>
      </>
    );
  }, [intl, form, isAgreed, handleAgreementCheck, handleReg, termsUrl, privacyUrl, handleLegalLinkClick]);

  useEffect(() => {
    if (open) return;

    if (AbortControllerRef.current) {
      try {
        AbortControllerRef.current.signal.throwIfAborted();
        AbortControllerRef.current.abort();
      } catch (e) {
        console.error(e);
      }
      AbortControllerRef.current = null;
    }
  }, [isRegister, open]);

  useEffect(() => {
    if (canRegister) {
      setLoginChannel('phone');
    } else {
      setLoginChannel('account');
    }
  }, [canRegister]);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={760}
      centered
      className={classNames(styles.loginModal, className)}
      destroyOnHidden
      forceRender
    >
      <div className={styles.container}>
        <div className={styles.leftSection}>
          <img
            width="100%"
            height="100%"
            src={`${getPublicPath()}beyond/${getLocale() === 'zh-CN' ? 'loginBg' : 'loginBg_en-US'}.png`}
            style={{
              objectFit: 'cover',
            }}
            alt=""
            // eslint-disable-next-line react/no-unknown-property
            fetchPriority="low"
          />
        </div>
        <div className={classNames(styles.rightSection)}>
          {isRegister && RegisteredRenderer()}
          {!isRegister && LoginRenderer()}
        </div>
      </div>
    </Modal>
  );
};

export default LoginModal;
