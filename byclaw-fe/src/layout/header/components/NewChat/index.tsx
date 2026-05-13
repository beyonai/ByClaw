import React, { useCallback } from 'react';
import classNames from 'classnames';
import { useLocation, useNavigate, useSelector } from '@umijs/max';
import styles from './index.module.less';
import { getPublicPath } from '@/utils';
import { getAgentChatAvatar } from '@/utils/agent';
import useGlobal from '@/hooks/useGlobal';
import useNewChat from './useNewChat';

export default function NewChat() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { agentList } = useSelector((state) => state.employees);
  const { setAgentId, setSessionId } = useGlobal();

  const handleNewChat = useNewChat();

  const handleClickAddChat = useCallback(
    (menuItemInfo: any) => {
      if (!menuItemInfo.path) return;

      if (menuItemInfo.id) {
        // 聊天模块的要清空sessionId并设置agentId
        setSessionId?.('');
        setAgentId?.(`${menuItemInfo.id}`);
      }

      navigate(menuItemInfo.path);
    },
    [navigate, setSessionId, setAgentId]
  );

  return (
    <div className={styles.dropdownMenuWrap}>
      <div className={styles.dropdownTop}>
        <div className={styles.addContentBox} onClick={handleNewChat}>
          <img className={styles.imgSuperAssist} src={`${getPublicPath()}beyond/logo100.svg`} alt="百应" />
          <div className={classNames(styles.addContentBoxTitle, styles.addContentBoxTitleAssist)}>个人助理</div>
        </div>
      </div>
      <div className={styles.dropdownGrid}>
        {agentList.map((item: any) => {
          return (
            <div
              className={styles.gridItem}
              key={item.id}
              onClick={() => {
                if (pathname === item.path) return;
                handleClickAddChat(item);
              }}
            >
              <div className={styles.avatar}>{getAgentChatAvatar(item.chatAvatar)}</div>
              <div className={styles.gridText}>{item.name}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
