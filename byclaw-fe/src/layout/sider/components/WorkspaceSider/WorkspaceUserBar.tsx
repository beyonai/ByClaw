import React from 'react';
import { Dropdown } from 'antd';
// @ts-ignore
import { useSelector } from '@umijs/max';
import useUserDropdown from '@/layout/header/useUserDropdown';
import { getDisplayUserNameInChat } from '@/utils/chat';
import SandboxStatusIndicator from '../SandboxStatus';
import styles from './index.module.less';

const WorkspaceUserBar: React.FC = () => {
  const userInfo = useSelector(({ user }: any) => user.userInfo);
  const { userDropdownItems, onUserDropdownClick, userDropdownRender } = useUserDropdown(userInfo);

  if (!userInfo) return null;

  const userName = userInfo.userName || '';
  const avatarText = getDisplayUserNameInChat(userName);

  return (
    <div className={styles.workspaceUserFooter}>
      <div className={styles.workspaceUserBar}>
        <Dropdown
          trigger={['hover', 'click']}
          placement="topRight"
          mouseEnterDelay={0.15}
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
