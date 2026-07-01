import React from 'react';
import { Badge } from 'antd';
import { getAgentChatAvatar } from '@/utils/agent';
import styles from './index.module.less';

interface Props {
  item: any;
  highlight: (text: string) => React.ReactNode;
  onClick: (item: any) => void;
}

const ChatRecordResultItem = ({ item, highlight, onClick }: Props) => (
  <div className={styles.itemBox} key={item.sessionId} onClick={() => onClick(item)}>
    <div className={styles.avatarWrapper}>
      <Badge count={item.unread} size="small">
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            backgroundColor: `var(--${PREFIX_NAME}-${item.theme}-2)`,
          }}
        >
          {getAgentChatAvatar(item.avatar)}
        </div>
      </Badge>
    </div>
    <div className={styles.itemContent}>
      <span className={styles.itemTitle}>{highlight(item.sessionName)}</span>
      <span className={styles.itemDesc}>{highlight(item.sessionContent || item.createTime)}</span>
    </div>
  </div>
);

export default ChatRecordResultItem;
