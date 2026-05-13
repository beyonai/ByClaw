import ChatLayoutComp, { IChatLayoutCompRef } from '@/components/ChatLayoutComp';
import {
  destroyOpenClawWebSocket,
  getOpenClawWebSocket,
  initOpenClawWebSocket,
} from '@/utils/openClaw/openclawWebSocket';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector, useIntl } from '@umijs/max';
import useGlobal from '@/hooks/useGlobal';
import { Spin, Button } from 'antd';
import useCreateSession from './useCreateSession';
import useLoadHistory from './useLoadHistory';

import styles from './index.module.less';
import classNames from 'classnames';
import { IMessage } from '@/typescript/message';
import type { ISessionState as UseSessionIState } from '@/models/session';

export default function OpenClawBot({ onReload }: { onReload: () => void }) {
  const dispatch = useDispatch();

  const { agentInfo, sessionId, EventEmitter, setSessionId } = useGlobal();
  const chatLayoutCompRef = useRef<IChatLayoutCompRef>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [canReconnect, setCanReconnect] = useState(true);

  const intl = useIntl();

  const setMessageList = useCallback(
    (messageList: IMessage[]) => {
      chatLayoutCompRef.current?.setMessageList(messageList);
      EventEmitter.emit('scrollToMsgOnSessionChanged', {});
      requestIdleCallback(() => {
        chatLayoutCompRef.current?.scrollToBottom?.({ behavior: 'instant' });
      });
    },
    [EventEmitter]
  );

  const createSession = useCreateSession();
  const loadHistory = useLoadHistory({ setMessageList });

  const { nextSessionRawFileCache } = useSelector(({ session }: { session: UseSessionIState }) => session);

  const agentId = agentInfo?.id;
  const agentHomeUrl = agentInfo?.agentHomeUrl;

  const connectOpenClawWebSocket = useCallback(async () => {
    if (!agentId || !agentHomeUrl) return;
    let globalClient = getOpenClawWebSocket();
    if (!globalClient && agentHomeUrl) {
      let originUrl = agentHomeUrl;
      if (process.env.NODE_ENV === 'development') {
        const targetURL = new URL(URI_TARGET);
        const originUrlObj = new URL(originUrl);
        originUrlObj.protocol = targetURL.protocol;
        originUrl = originUrlObj.toString();
      }

      globalClient = initOpenClawWebSocket(originUrl, String(agentId));
    }
    if (!globalClient) return;

    // 设置重连失败回调
    globalClient.setOnReconnectFailed(() => {
      setCanReconnect(true);
    });

    globalClient.setOnConnected(() => {
      setIsLoading(false);
      setCanReconnect(false);
      createSession(String(agentId)).then((res) => {
        if (res?.sessionId) {
          globalClient.setRealSessionId(String(res.sessionId));
          setSessionId?.(String(res.sessionId));
        }
        // 连接成功并创建会话后，加载历史记录到聊天组件
        requestIdleCallback(() => loadHistory());
      });
    });

    // 重置重连状态
    setCanReconnect(false);
    setIsLoading(true);

    globalClient.ensureConnected();
  }, [agentId, agentHomeUrl]);

  useEffect(() => {
    connectOpenClawWebSocket();
  }, [connectOpenClawWebSocket]);

  useEffect(() => {
    if (isLoading) return;
    if (nextSessionRawFileCache.length > 0) {
      setTimeout(() => {
        EventEmitter.emit('queryInput-paste-files', nextSessionRawFileCache);
        dispatch({
          type: 'session/save',
          payload: {
            nextSessionRawFileCache: [],
          },
        });
      }, 500);
    }
  }, [isLoading, nextSessionRawFileCache, EventEmitter, dispatch]);

  useEffect(() => {
    return () => {
      destroyOpenClawWebSocket();
    };
  }, []);

  if (isLoading || !sessionId) {
    return (
      <Spin
        spinning
        wrapperClassName={classNames('ub ub-ac ub-pc', styles.spin)}
        tip={
          <div className="ub ub-ac ub-pc ub-ver gap8" style={{ marginTop: '16px' }}>
            {!sessionId && <p>{intl.formatMessage({ id: 'sandbox.waitTips' })}</p>}
            {canReconnect && (
              <Button
                onClick={() => {
                  // 销毁当前 WebSocket 连接
                  destroyOpenClawWebSocket();
                  // 跳转到 sandbox 页面，重新初始化
                  onReload();
                }}
              >
                {intl.formatMessage({ id: 'common.reconnect' })}
              </Button>
            )}
          </div>
        }
      >
        <></>
      </Spin>
    );
  }

  return <ChatLayoutComp cannotAt isBottom hideAction sessionId={sessionId} ref={chatLayoutCompRef} />;
}
