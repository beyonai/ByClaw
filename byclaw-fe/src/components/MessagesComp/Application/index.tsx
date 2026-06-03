import React, { useEffect } from 'react';
import { useIntl, useSelector } from '@umijs/max';
import classnames from 'classnames';
import { Typography, Button } from 'antd';
import { get, isNil, last, size } from 'lodash';
import useDefaultAgentInfo from './useDefaultAgentInfo';
import { getAgentChatAvatar } from '@/utils/agent';
import type { IMessage, IMessageListItem } from '@/typescript/message';
import { MessageListContext } from '@/components/MessageList/index';

import styles from './index.module.less';
import useGlobal from '@/hooks/useGlobal';
import { IAgentCache, IAgentType } from '@/typescript/agent';
import ApplicationSession from '@/components/ApplicationSession';
import useAppStore from '@/models/common/useAppStore';
import { IMessageState } from '@/constants/message';
import type { ISendConf, ISendProps } from '@/hooks/useChat';

const { Paragraph } = Typography;

export type IMessageListItemContent = {
  substance: {
    args: {
      input: string;
      files?: any[];
      [key: string]: any;
    };
    agentId: string;
    dynamic_agent_card_func: boolean;
    agentType: IAgentType;
    currentSessionId: string;
    agentName: string;
    createType: string;
    sessionId: string;
    agentHomeUrl?: string;
    agentDescription: string;
    isSubagent?: boolean;
    integrationType: 'PAGE' | 'INTERFACE' | 'NONE';
    recover: boolean;
    status?: number; // 暂时小置办才会有这个字段，且初始化时没有； 0 或 空 - 未完成； 1 - 已完成
  };
  stepId: string;
};

export type IProps = {
  message: IMessage;
  updateMessageListItemContent: (messageListItemContent: IMessageListItemContent) => void;
  messageIdx: number;
  messageListItemContent: IMessageListItemContent;
  thinkListItem?: IMessageListItem;
};

const latestSendSummaryPayloadRef: React.RefObject<{
  sendProps: ISendProps;
  sendConf?: ISendConf;
} | null> = {
  current: null,
};

function Application(props: IProps) {
  const { messageListItemContent, message, updateMessageListItemContent, messageIdx, thinkListItem } = props;
  const intl = useIntl();
  const { substance } = messageListItemContent || {};
  const { messageList, thinkList, isHistoryMsg } = message || {};

  const { agentId, agentType, agentDescription, recover = false, status } = substance || {};
  const input = get(substance, 'args.input');

  const { EventEmitter } = useGlobal();
  const { setSiderCollapsed } = useAppStore();

  const agentInfo = useDefaultAgentInfo({
    agentType,
    agentId,
  });
  const userInfo = useSelector(({ user }) => user.userInfo);

  const { name, chatAvatar, integrationType } = agentInfo as IAgentCache;
  const canClick = !!userInfo;

  const isLastMessageItem = React.useMemo(() => {
    if (thinkListItem) {
      return size(thinkList) === messageIdx + 1;
    }
    return size(messageList) === messageIdx + 1;
  }, [thinkListItem, thinkList, messageList, messageIdx]);

  let isDone = (!isLastMessageItem || `${status}` === '1') && !isNil(status);
  if (isHistoryMsg) {
    isDone = true;
  }
  const { messageList: sessionMessageList } = React.useContext(MessageListContext);
  const { messageState: sessionLastMsgState } = last(sessionMessageList) || {};

  const canSendSummary = React.useMemo(() => {
    return !sessionLastMsgState || ![IMessageState.Query, IMessageState.Answer].includes(sessionLastMsgState);
  }, [sessionLastMsgState]);

  const onSendSummary = React.useCallback(
    (payload: { sendProps: ISendProps; sendConf?: ISendConf }) => {
      if (canSendSummary) {
        EventEmitter.emit('beyond-chat-on-send-msg', payload);
        latestSendSummaryPayloadRef.current = null;
        return;
      }

      latestSendSummaryPayloadRef.current = payload;
    },
    [EventEmitter, canSendSummary]
  );

  useEffect(() => {
    if (!canSendSummary) return;

    const pendingPayload = latestSendSummaryPayloadRef.current;
    if (!pendingPayload) return;

    latestSendSummaryPayloadRef.current = null;
    EventEmitter.emit('beyond-chat-on-send-msg', pendingPayload);
  }, [canSendSummary]);

  React.useEffect(() => {
    let isPage = integrationType === 'PAGE';
    if (!isPage || isDone) return;
    setSiderCollapsed(true);
    EventEmitter.emit('beyond-main-driver-open-type', {
      width: '50vw',
      drawerType: (
        <ApplicationSession
          isDone={isDone}
          onClose={() => {
            setSiderCollapsed(false);
            EventEmitter.emit('beyond-driver-close');
            EventEmitter.emit('beyond-fullscreen-modal-open-type', '');
          }}
          currentMessage={{ ...message }}
          messageListItemContent={{ ...messageListItemContent }}
          onSendSummary={onSendSummary}
          onUpdateMessage={(
            payload: Partial<IMessage> & {
              messageId: string;
            }
          ) => {
            if (!payload.messageId) return;
            EventEmitter.emit('beyond-update-message', {
              message: payload,
              opt: {},
            });
          }}
        />
      ),
    });
  }, []);

  return (
    <div
      className={classnames(styles.temporaryComp, 'ub ub-ac gap8', {
        pointer: canClick,
      })}
      onClick={() => {
        if (!canClick) return;
        EventEmitter.emit('beyond-fullabsolute-driver-open-type', {
          drawerType: 'application',
          canClose: false,
        });
        EventEmitter.emit('beyond-fullabsolute-driver-message', {
          currentMessage: {
            ...message,
          },
          messageListItemContent: { ...messageListItemContent },
          currentUpdateMessageListItemContent: updateMessageListItemContent,
          autoAsk: isLastMessageItem,
          toRecover: recover,
          isDone,
        });
      }}
    >
      <div className={classnames(styles.agentInfo, 'ub ub-f1 ub-ac gap4')}>
        <div className={styles.avatar}>{getAgentChatAvatar(chatAvatar)}</div>
        <div className="ub-f1">
          <Paragraph style={{ fontSize: '14px', marginBottom: 0 }} ellipsis={{ rows: 1 }}>
            {name}
          </Paragraph>
          <Paragraph style={{ color: '#707680', fontSize: '12px', marginBottom: 0 }} ellipsis={{ rows: 1 }}>
            {agentDescription}
          </Paragraph>
        </div>
      </div>
      <div className={classnames('ub ub-f1 ub-ac gap4', styles.content)}>
        <div className="ub gap4" style={{ color: 'var(--beyond-color-primary)' }}>
          <div className="ub ub-ac" style={{ width: 16, height: 16, marginTop: 3 }}>
            {getAgentChatAvatar(chatAvatar)}
          </div>
          <div style={{ maxWidth: 100 }}>
            <Paragraph
              style={{ fontSize: '14px', marginBottom: 0, color: 'var(--beyond-color-primary)' }}
              ellipsis={{ rows: 1 }}
            >
              {name}
            </Paragraph>
          </div>
          :
        </div>
        <div className="ub-f1">
          <Paragraph
            style={{
              marginBottom: 0,
              fontSize: 14,
              color: '#14161a',
            }}
            ellipsis={{ rows: 2 }}
          >
            {input}
          </Paragraph>
        </div>
      </div>
      <Button type="text" style={{ color: '#707680', fontSize: '12px' }} size="small">
        {intl.formatMessage({ id: 'application.enter' })}
      </Button>
    </div>
  );
}

export default Application;
