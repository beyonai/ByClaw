import React from 'react';
import { ISession } from '@/typescript/session';
import { getAgentChatAvatar } from '@/utils/agent';

interface ChatAvatarProps {
  session: ISession;
  size?: number;
}

const ChatAvatar: React.FC<ChatAvatarProps> = (props) => {
  const { session, size = 32 } = props;

  const renderChatAvatar = (item: ISession) => {
    return getAgentChatAvatar(item.avatar);
  };

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: `var(--${PREFIX_NAME}-${session.theme}-2)`,
        overflow: 'hidden',
      }}
      className="ub ub-ac ub-pc"
    >
      {renderChatAvatar(session)}
    </div>
  );
};

export default ChatAvatar;
