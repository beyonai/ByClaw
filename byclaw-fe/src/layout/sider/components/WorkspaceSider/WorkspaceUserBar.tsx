import React from 'react';
import { Dropdown } from 'antd';
// @ts-ignore
import { getLocale, setLocale, useIntl, useSelector } from '@umijs/max';
import AntdIcon from '@/components/AntdIcon';
import useUserDropdown from '@/layout/header/useUserDropdown';
import { getDisplayUserNameInChat } from '@/utils/chat';
import SandboxStatusIndicator from '../SandboxStatus';
import styles from './index.module.less';

const WorkspaceUserBar: React.FC = () => {
  const intl = useIntl();
  const userInfo = useSelector(({ user }: any) => user.userInfo);
  const { userDropdownItems, onUserDropdownClick, userDropdownRender } = useUserDropdown(userInfo);
  const locale = getLocale() || 'zh-CN';

  if (!userInfo) return null;

  const userName = userInfo.userName || '';
  const avatarText = getDisplayUserNameInChat(userName);

  return (
    <div className={styles.workspaceUserFooter}>
      <div className={styles.workspaceUserBar}>
        <Dropdown
          trigger={['click']}
          placement="topRight"
          overlayStyle={{ minWidth: 240 }}
          menu={{ items: userDropdownItems, onClick: onUserDropdownClick }}
          popupRender={userDropdownRender}
        >
          <div className={styles.workspaceUserIdentity} role="button" tabIndex={0} title={userName}>
            <span className={styles.workspaceUserAvatar}>
              <span>{avatarText}</span>
              {userInfo.avatar && (
                <img
                  src={userInfo.avatar}
                  alt={userName}
                  onError={(event) => {
                    event.currentTarget.style.display = 'none';
                  }}
                />
              )}
            </span>
            <span className={styles.workspaceUserName}>{userName}</span>
          </div>
        </Dropdown>
        <span className={styles.workspaceUserLocale} onClick={(event) => event.stopPropagation()}>
          <Dropdown
            trigger={['click']}
            placement="topRight"
            menu={{
              selectedKeys: [locale],
              items: [
                {
                  key: 'en-US',
                  label: (
                    <span className={styles.workspaceUserLocaleOption}>
                      <span className={styles.workspaceUserLocaleFlag} aria-hidden>
                        🇺🇸
                      </span>
                      English
                    </span>
                  ),
                },
                {
                  key: 'zh-CN',
                  label: (
                    <span className={styles.workspaceUserLocaleOption}>
                      <span className={styles.workspaceUserLocaleFlag} aria-hidden>
                        🇨🇳
                      </span>
                      简体中文
                    </span>
                  ),
                },
              ],
              onClick: ({ key, domEvent }) => {
                domEvent.stopPropagation();
                if (key !== locale) setLocale(key);
              },
            }}
          >
            <button
              type="button"
              className={styles.workspaceUserLocaleButton}
              aria-label={intl.formatMessage({ id: 'settings.language' })}
              title={intl.formatMessage({ id: 'settings.language' })}
            >
              <AntdIcon type="icon-a-Translatefanyi" />
            </button>
          </Dropdown>
        </span>
        {userInfo.userCode && (
          <span className={styles.workspaceUserSandboxStatus} onClick={(event) => event.stopPropagation()}>
            <SandboxStatusIndicator userCode={userInfo.userCode} />
          </span>
        )}
      </div>
    </div>
  );
};

export default WorkspaceUserBar;
