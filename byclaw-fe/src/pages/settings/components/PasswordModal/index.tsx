import React, { useCallback, useMemo, useState } from 'react';

import { CheckCircleFilled, CloseCircleFilled, EyeInvisibleOutlined, EyeTwoTone } from '@ant-design/icons';
import { Alert, Button, Form, Input, message, Modal, Popover } from 'antd';
// @ts-ignore
import { useIntl, useSelector } from '@umijs/max';

import { globalLogout } from '@/service/common/request';
import { updatePassword } from '@/service/user';
import { encryptBySM } from '@/utils/encrypt/sm';
import styles from './index.module.less';

interface PasswordModalProps {
  visible: boolean;
  onClose: () => void;
  logoutOnSuccess: boolean;
  unclosable?: boolean;
}

const PasswordModal: React.FC<PasswordModalProps> = ({ visible, onClose, unclosable, logoutOnSuccess = false }) => {
  // 获取用户信息
  const userInfo = useSelector((state: any) => state.user?.userInfo) || {};
  const intl = useIntl();

  const [form] = Form.useForm();
  const newPassword = Form.useWatch('newPassword', form);

  const [loading, setLoading] = useState<boolean>(false);
  const [showPopover, setShowPopover] = useState<boolean>(false);

  // 处理表单提交
  const handleSubmit = useCallback(async () => {
    try {
      const values = await form.validateFields();
      if (!values) return;

      setLoading(true);
      const { oldPassword, newPassword } = values;

      const res = await updatePassword({
        userId: userInfo?.userId,
        oldPassword: encryptBySM(oldPassword),
        newPassword: encryptBySM(newPassword),
      });
      if (res) {
        message.success(intl.formatMessage({ id: 'settings.passwordChangedSuccess' }));
        onClose();
        if (logoutOnSuccess) {
          globalLogout();
        }
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [form, userInfo, intl, logoutOnSuccess]);

  // 检查密码是否同时包含大小写字母、数字和特殊符号中的至少3种
  const hasEnoughComplexity = useCallback((password: string = '') => {
    let complexityCount = 0;
    if (/[A-Z]/.test(password)) complexityCount += 1;
    if (/[a-z]/.test(password)) complexityCount += 1;
    if (/\d/.test(password)) complexityCount += 1;
    if (/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) complexityCount += 1;
    return complexityCount >= 4;
  }, []);

  // 检查密码是否只包含允许的字符
  const hasOnlyValidChars = useCallback((password: string = '') => {
    return /^[A-Za-z0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]*$/.test(password);
  }, []);

  // 检查密码长度是否在8-32之间
  const hasValidLength = useCallback((password: string = '') => {
    return password.length >= 8 && password.length <= 32;
  }, []);

  // 新密码复杂度校验
  const validatePasswordComplexity = useCallback(
    (_: any, value: string) => {
      if (!value) {
        return Promise.reject(new Error(intl.formatMessage({ id: 'settings.pleaseEnterNewPassword' })));
      }

      if (!(hasEnoughComplexity(value) && hasValidLength(value) && hasOnlyValidChars(value))) {
        return Promise.reject(new Error(intl.formatMessage({ id: 'settings.passwordComplexityError' })));
      }

      return Promise.resolve();
    },
    [hasEnoughComplexity, hasValidLength, hasOnlyValidChars, intl]
  );

  const renderPasswordRules = useMemo(() => {
    return (
      <div className={styles.passwordRuleTooltip}>
        <div className={styles.ruleItem}>
          {hasEnoughComplexity(newPassword) ? (
            <CheckCircleFilled className={styles.checkIcon} />
          ) : (
            <CloseCircleFilled className={styles.closeIcon} />
          )}
          <span>{intl.formatMessage({ id: 'settings.passwordRule1' })}</span>
        </div>
        <div className={styles.ruleItem}>
          {hasOnlyValidChars(newPassword) ? (
            <CheckCircleFilled className={styles.checkIcon} />
          ) : (
            <CloseCircleFilled className={styles.closeIcon} />
          )}
          <span>{intl.formatMessage({ id: 'settings.passwordRule2' })}</span>
        </div>
        <div className={styles.ruleItem}>
          {hasValidLength(newPassword) ? (
            <CheckCircleFilled className={styles.checkIcon} />
          ) : (
            <CloseCircleFilled className={styles.closeIcon} />
          )}
          <span>{intl.formatMessage({ id: 'settings.passwordRule3' })}</span>
        </div>
      </div>
    );
  }, [newPassword, hasEnoughComplexity, hasOnlyValidChars, hasValidLength, intl]);

  // 确认密码必须与新密码一致
  const validateConfirmPassword = useCallback(
    (_: any, value: string) => {
      if (!value) {
        return Promise.reject(new Error(intl.formatMessage({ id: 'settings.pleaseConfirmPassword' })));
      }

      const newPassword = form.getFieldValue('newPassword');
      if (value && value !== newPassword) {
        return Promise.reject(new Error(intl.formatMessage({ id: 'settings.passwordsMustMatch' })));
      }
      return Promise.resolve();
    },
    [form, intl]
  );

  return (
    <Modal
      title={intl.formatMessage({ id: 'settings.changePassword' })}
      open={visible}
      onCancel={onClose}
      onOk={handleSubmit}
      confirmLoading={loading}
      width={480}
      closable={!unclosable}
      maskClosable={!unclosable}
      destroyOnHidden
      styles={{
        header: { border: 'none' },
        footer: { border: 'none' },
      }}
      cancelButtonProps={
        unclosable
          ? {
            style: {
              display: 'none',
            },
          }
          : undefined
      }
    >
      {unclosable && (
        <Button type="text" onClick={() => globalLogout()} className={styles.logoutBtn}>
          {intl.formatMessage({ id: 'contentHeader.logout' })}
        </Button>
      )}
      <Alert
        message={
          <div>
            {unclosable && (
              <div style={{ marginBottom: 10, fontWeight: 500 }}>
                {intl.formatMessage({ id: 'settings.password.modTips' })}
              </div>
            )}
            <div style={unclosable ? { fontSize: 12 } : undefined}>
              {intl.formatMessage({ id: 'settings.passwordComplexityRequirement' })}
            </div>
          </div>
        }
        type="warning"
        showIcon
        className={styles.passwordAlert}
      />

      <Form form={form} layout="vertical">
        <Form.Item
          name="oldPassword"
          label={intl.formatMessage({ id: 'settings.oldPassword' })}
          rules={[
            {
              required: true,
              message: intl.formatMessage({
                id: 'settings.pleaseEnterOldPassword',
              }),
            },
          ]}
        >
          <Input.Password
            placeholder={intl.formatMessage({
              id: 'settings.pleaseEnterOldPassword',
            })}
            iconRender={(visible) => (visible ? <EyeTwoTone /> : <EyeInvisibleOutlined />)}
          />
        </Form.Item>

        <Popover
          placement="bottomLeft"
          content={renderPasswordRules}
          open={showPopover}
          overlayClassName={styles.passwordPopover}
        >
          <Form.Item
            name="newPassword"
            label={intl.formatMessage({ id: 'settings.newPassword' })}
            required
            rules={[{ validator: validatePasswordComplexity }]}
          >
            <Input.Password
              placeholder={intl.formatMessage({
                id: 'settings.pleaseEnterNewPassword',
              })}
              iconRender={(visible) => (visible ? <EyeTwoTone /> : <EyeInvisibleOutlined />)}
              onFocus={() => setShowPopover(true)}
              onBlur={() => setShowPopover(false)}
            />
          </Form.Item>
        </Popover>

        <Form.Item
          name="confirmPassword"
          label={intl.formatMessage({ id: 'settings.confirmNewPassword' })}
          required
          rules={[{ validator: validateConfirmPassword }]}
        >
          <Input.Password
            placeholder={intl.formatMessage({
              id: 'settings.pleaseConfirmPassword',
            })}
            iconRender={(visible) => (visible ? <EyeTwoTone /> : <EyeInvisibleOutlined />)}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default PasswordModal;
