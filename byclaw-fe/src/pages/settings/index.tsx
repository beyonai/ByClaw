import React, { useState } from 'react';

import {
  DownOutlined,
  FileTextOutlined,
  GlobalOutlined,
  LockOutlined,
  RightOutlined,
  SkinOutlined,
  UserOutlined,
} from '@ant-design/icons';
// @ts-ignore
import { getLocale, setLocale, useIntl, useSelector } from '@umijs/max';
import { Avatar, Card, Modal, Select, Space, Typography } from 'antd';

import AntdIcon from '@/components/AntdIcon';
import { globalLogout } from '@/service/common/request';
import classNames from 'classnames';
import PasswordModal from './components/PasswordModal';
import styles from './index.module.less';

const { Option } = Select;
const { Text } = Typography;

const Settings: React.FC = () => {
  const intl = useIntl();
  const language = getLocale();
  const [modal, contextHolder] = Modal.useModal();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [theme, setTheme] = useState<string>('light');
  const [showPassword, setShowPassword] = useState<boolean>(false);

  // 获取用户信息
  const userInfo = useSelector((state: any) => state.user?.userInfo) || {};

  return (
    <div className={styles.settingsContainer}>
      <div className={styles.settingsContent}>
        <span className={styles.settingsTitle}>{intl.formatMessage({ id: 'contentHeader.settings' })}</span>

        {/* 用户信息卡片 */}
        <Card className={styles.settingsCard}>
          <div className={styles.userInfoContainer}>
            <Space size={16}>
              <Avatar size={48} src={userInfo.avatar} icon={<UserOutlined />} />
              <div className={styles.userInfo}>
                <Text strong className={styles.userName}>
                  {userInfo.userName || intl.formatMessage({ id: 'settings.notLoggedIn' })}
                </Text>
                <Text className={styles.userId}>{userInfo.userCode || ''}</Text>
              </div>
            </Space>
            {/** 因为现在点了没用，没写事件，先注释这个令人误解的箭头 */}
            {/* <RightOutlined className={styles.arrowIcon} /> */}
          </div>
        </Card>

        <div className={classNames(styles.settingBox, 'ub ub-ver')}>
          {/* 界面主题 */}
          <div className={styles.settingItem}>
            <div className={styles.settingLabel}>
              <SkinOutlined className={styles.settingIcon} />
              <span>{intl.formatMessage({ id: 'settings.uiTheme' })}</span>
            </div>
            <Select value={theme} className={styles.selectBox} variant="filled" disabled suffixIcon={<DownOutlined />}>
              <Option value="light">{intl.formatMessage({ id: 'settings.lightMode' })}</Option>
              <Option value="dark">{intl.formatMessage({ id: 'settings.darkMode' })}</Option>
              <Option value="system">{intl.formatMessage({ id: 'settings.systemMode' })}</Option>
            </Select>
          </div>

          {/* 语言设置 */}
          <div className={styles.settingItem}>
            <div className={styles.settingLabel}>
              <GlobalOutlined className={styles.settingIcon} />
              <span>{intl.formatMessage({ id: 'settings.language' })}</span>
            </div>
            <Select
              // 因为现在还有很多国际化都没做，先注释掉
              disabled
              value={language}
              onChange={(value) => {
                setLocale(value);
              }}
              className={styles.selectBox}
              variant="filled"
              suffixIcon={<DownOutlined />}
            >
              <Option value="zh-CN">{intl.formatMessage({ id: 'settings.chinese' })}</Option>
              <Option value="en-US">English</Option>
            </Select>
          </div>
        </div>

        <div className={classNames(styles.settingBox, styles.canClick, 'ub ub-ver disabled')}>
          {/* 用户协议 */}
          <div className={styles.settingItem}>
            <div className={styles.settingLabel}>
              <FileTextOutlined className={styles.settingIcon} />
              <span>{intl.formatMessage({ id: 'settings.userAgreement' })}</span>
            </div>
            <RightOutlined className={styles.arrowIcon} />
          </div>

          {/* 隐私协议 */}
          <div className={styles.settingItem}>
            <div className={styles.settingLabel}>
              <FileTextOutlined className={styles.settingIcon} />
              <span>{intl.formatMessage({ id: 'settings.privacyPolicy' })}</span>
            </div>
            <RightOutlined className={styles.arrowIcon} />
          </div>
        </div>

        {/* 修改密码 */}
        {`${userInfo.registerType}` !== '1' && (
          <div
            className={classNames(styles.settingBox, styles.canClick, 'ub ub-ver')}
            onClick={() => setShowPassword(true)}
          >
            <div className={styles.settingItem}>
              <div className={styles.settingLabel}>
                <LockOutlined className={styles.settingIcon} />
                <span>{intl.formatMessage({ id: 'settings.changePassword' })}</span>
              </div>
              <RightOutlined className={styles.arrowIcon} />
            </div>
          </div>
        )}

        {/* 退出登录 */}
        <div
          className={classNames(styles.settingBox, 'ub ub-ac ub-pc')}
          onClick={() => {
            modal.confirm({
              title: intl.formatMessage({
                id: 'contentHeader.confirmOperation',
              }),
              content: intl.formatMessage({
                id: 'contentHeader.confirmLogout',
              }),
              onOk: () => {
                globalLogout();
              },
            });
          }}
        >
          <AntdIcon type="icon-a-shouye-Logouttuichu" style={{ fontSize: 18 }} />
          <span>{intl.formatMessage({ id: 'contentHeader.logout' })}</span>
        </div>
      </div>

      {showPassword && <PasswordModal visible={showPassword} onClose={() => setShowPassword(false)} />}

      {contextHolder}
    </div>
  );
};

export default Settings;
