import React, { useEffect, useState } from 'react';

import {
  DownOutlined,
  FileTextOutlined,
  GlobalOutlined,
  LockOutlined,
  MailOutlined,
  RightOutlined,
  SettingOutlined,
  SkinOutlined,
  UserOutlined,
} from '@ant-design/icons';
// @ts-ignore
import { getLocale, setLocale, useIntl, useSelector } from '@umijs/max';
import { Avatar, Card, Menu, Modal, Select, Space, Typography } from 'antd';

import useAppStore from '@/models/common/useAppStore';
import AntdIcon from '@/components/AntdIcon';
import { globalLogout } from '@/service/common/request';
import { getPublicPath } from '@/utils';
import classNames from 'classnames';
import PasswordModal from './components/PasswordModal';
import PersonalEmailSettings from './components/PersonalEmailSettings';
import styles from './index.module.less';

const { Option } = Select;
const { Text } = Typography;

type SettingsMenuKey = 'general' | 'email';

const Settings: React.FC = () => {
  const { versionInfo, getVersionInfo } = useAppStore();

  const intl = useIntl();
  const language = getLocale();
  const [modal, contextHolder] = Modal.useModal();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [theme, setTheme] = useState<string>('light');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [activeMenu, setActiveMenu] = useState<SettingsMenuKey>('general');
  const termsUrl = `${getPublicPath()}legal/terms/index.html`;
  const privacyUrl = `${getPublicPath()}legal/privacy/index.html`;

  const openLegalPage = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  // 获取用户信息
  const userInfo = useSelector((state: any) => state.user?.userInfo) || {};

  useEffect(() => {
    if (userInfo && !versionInfo) {
      getVersionInfo();
    }
  }, [userInfo, versionInfo]);

  const renderGeneralSettings = () => (
    <>
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
        </div>
      </Card>

      {/* 版本信息 */}
      <>
        {versionInfo?.version && (
          <div className={classNames(styles.settingBox, 'ub ub-ver')}>
            <div className={styles.settingItem}>
              <div className={styles.settingLabel}>
                {/* <SkinOutlined className={styles.settingIcon} /> */}
                <span>{intl.formatMessage({ id: 'sider.version' })}</span>
              </div>
              <>{versionInfo?.version}</>
            </div>
          </div>
        )}
      </>

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
            value={language}
            onChange={(value) => {
              setLocale(value);
            }}
            className={styles.selectBox}
            variant="filled"
            suffixIcon={<DownOutlined />}
          >
            <Option value="zh-CN">简体中文</Option>
            <Option value="en-US">English</Option>
          </Select>
        </div>
      </div>

      <div className={classNames(styles.settingBox, styles.canClick, 'ub ub-ver')}>
        {/* 使用协议 */}
        <div className={styles.settingItem} onClick={() => openLegalPage(termsUrl)}>
          <div className={styles.settingLabel}>
            <FileTextOutlined className={styles.settingIcon} />
            <span>{intl.formatMessage({ id: 'settings.userAgreement' })}</span>
          </div>
          <RightOutlined className={styles.arrowIcon} />
        </div>

        {/* 隐私政策 */}
        <div className={styles.settingItem} onClick={() => openLegalPage(privacyUrl)}>
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
    </>
  );

  return (
    <div className={styles.settingsPage}>
      <aside className={styles.settingsSider}>
        <div className={styles.profileBlock}>
          <Avatar size={44} src={userInfo.avatar} icon={<UserOutlined />} />
          <div>
            <div className={styles.profileName}>
              {userInfo.userName || intl.formatMessage({ id: 'settings.notLoggedIn' })}
            </div>
            <div className={styles.profileCode}>{userInfo.userCode || ''}</div>
          </div>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[activeMenu]}
          onClick={({ key }) => setActiveMenu(key as SettingsMenuKey)}
          items={[
            {
              key: 'general',
              icon: <SettingOutlined />,
              label: intl.formatMessage({ id: 'settings.general' }),
            },
            {
              key: 'email',
              icon: <MailOutlined />,
              label: intl.formatMessage({ id: 'settings.personalEmail' }),
            },
          ]}
        />
      </aside>

      <main className={styles.settingsMain}>
        <div className={styles.settingsContent}>
          <span className={styles.settingsTitle}>
            {activeMenu === 'general'
              ? intl.formatMessage({ id: 'settings.general' })
              : intl.formatMessage({ id: 'settings.personalEmail' })}
          </span>

          {activeMenu === 'general' ? renderGeneralSettings() : <PersonalEmailSettings />}
        </div>

        {showPassword && (
          <PasswordModal visible={showPassword} onClose={() => setShowPassword(false)} logoutOnSuccess={false} />
        )}

        {contextHolder}
      </main>
    </div>
  );
};

export default Settings;
