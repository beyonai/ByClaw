import React, { useRef, useState, useEffect } from 'react';
import classnames from 'classnames';
import { noop } from 'lodash';
import { useDispatch, useIntl } from '@umijs/max';
import { Button } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';

import { getPublicPath, getRootPagePath } from '@/utils';
import { getAgentChatAvatar } from '@/utils/agent';
import { agentTypeMap } from '@/constants/agent';

import useGlobal from '@/hooks/useGlobal';
import useChat from '@/hooks/useChat';

import MessageList from '@/pages/notice/components/MessageList';

import type { IAgentType } from '@/typescript/agent';

import styles from './index.module.less';
import { useNavigate } from 'react-router';

interface MessageListRefType {
  toBottom: () => void;
}

function Notice({ canBack }: { canBack?: boolean }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const intl = useIntl();

  const globalContext = useGlobal();
  const { sessionId } = globalContext;

  const messageListCompRef = useRef<MessageListRefType>(null);

  const [myAgentType] = useState<IAgentType>(agentTypeMap.common);

  const { hasMore, messageList, updateMessage, deleteMessage, onNext } = useChat({
    sessionId,
    agentType: myAgentType,
    addSession: noop,
  });

  useEffect(() => {
    if (!sessionId) {
      navigate(getRootPagePath());
    }
    return () => {
      dispatch({
        type: 'messageStore/cleanSessionMessage',
        payload: {
          sessionId,
        },
      });
    };
  }, [sessionId]);

  return (
    <div className={classnames(styles.chatLayoutCompBox, 'full-height full-width')}>
      <div className={classnames(styles.chatLayoutComp, 'full-width ub')}>
        <div className="ub ub-f1 ub-ver">
          <nav className={classnames(styles.chatTitle, 'ub ub-ac gap8')} style={{ justifyContent: 'space-between' }}>
            {canBack && (
              <Button
                icon={<ArrowLeftOutlined style={{ fontSize: '16px' }} />}
                type="text"
                onClick={() => {
                  history.back();
                }}
              />
            )}
            <div className={classnames(styles.chatTitleWrap, 'ub ub-ac gap8')}>
              <div style={{ height: '32px', width: '32px' }}>
                {getAgentChatAvatar('', `${getPublicPath()}beyond/noticeHead.png`)}
              </div>
              <div className={styles.chatTitle}>{intl.formatMessage({ id: 'notice.assistant' })}</div>
            </div>
            {canBack && <Button icon={<ArrowLeftOutlined />} type="text" style={{ visibility: 'hidden' }} />}
          </nav>
          <div className={classnames(styles.messageList, 'ub-f1 overflow-hidden')}>
            <MessageList
              ref={messageListCompRef}
              onNext={onNext}
              hasMore={hasMore}
              messageList={messageList}
              updateMessage={updateMessage}
              deleteMessage={deleteMessage}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default Notice;
