import React from 'react';
import { size, get, set } from 'lodash';
import { CheckCircleOutlined } from '@ant-design/icons';
// @ts-ignore
import { useIntl } from '@umijs/max';

import WaveBallLoading from '@/components/Loading/WaveBallLoading';

import { request } from '@/service/common/request';

import { IMessageState } from '@/constants/message';

import type { IBaseProps } from './index';
import useGlobal from '@/hooks/useGlobal';
import usePolling from '@/hooks/usePolling';

export type IMyProps = IBaseProps & {
  thinkListItem?: any[];
  messageListItemContent: {
    substance: {
      data?: {
        message: string;
      };
      url: string;
      method: 'POST' | 'GET' | 'PUT' | 'DELETE';
      recover?: boolean;
    };
  };
};

function Tools(props: IMyProps) {
  const { messageListItemContent, message, messageIdx, thinkListItem } = props;
  const { messageList, thinkList } = message;

  const intl = useIntl();
  const { substance } = messageListItemContent || {};
  const { url, method, recover = true } = substance;

  const { EventEmitter } = useGlobal();

  const [isRotating, setIsRotating] = React.useState<'-1' | '0' | '1' | ''>('');

  const abortControllerRef = React.useRef<AbortController>(null);

  const isLastMessageItem = React.useMemo(() => {
    if (thinkListItem) {
      return size(thinkList) === messageIdx + 1;
    }
    return size(messageList) === messageIdx + 1;
  }, [thinkListItem, thinkList, messageList, messageIdx]);

  const myQuery = React.useCallback(() => {
    try {
      if (abortControllerRef.current && !abortControllerRef.current?.signal.aborted) {
        abortControllerRef.current.abort('abort');
        abortControllerRef.current = null;
      }
    } catch (e) {
      console.error(e);
    }

    abortControllerRef.current = new AbortController();
    console.log(url, method);
    return request(
      url,
      {
        t: Date.now(),
      },
      { cancelToken: abortControllerRef.current },
      method
    );
  }, [method, url]);

  const onSuccess = React.useCallback((result: any) => {
    console.log('轮询查询成功:', result);

    if (result?.status === 'PROCESSING') {
      console.log('状态为 PROCESSING，将继续轮询...');
      return false;
    }

    // 状态不是 PROCESSING，处理完成
    console.log(`状态为 ${result?.status}，停止轮询并发送消息`);
    setIsRotating('0');

    const payload = {
      sendProps: {
        queryQuestion: result.message,
        payload: {
          llmMessageId: message.messageId,
          // relModelId: -1,
          taskOperateType: 'FEEDBACK',
          taskStepId: get(messageListItemContent, 'stepId'),
        },
        // msgOpt: {
        //   answerMsg: {
        //     ...message,
        //     messageState: IMessageState.Query,
        //   },
        //   queryMsg: {
        //     msgId: message.queryMsgId,
        //   },
        // },
      },
      // sendConf: {
      //   onlyQuery: true,
      // },
    };

    if (recover) {
      set(payload, 'sendConf', {
        onlyQuery: true,
      });
      set(payload, 'sendProps.msgOpt', {
        answerMsg: {
          ...message,
          messageState: IMessageState.Query,
        },
        queryMsg: {
          msgId: message.queryMsgId,
        },
      });
    }

    EventEmitter.emit('beyond-chat-on-send-msg', payload);

    return true;
  }, []);

  const onError = React.useCallback((error: any) => {
    console.error('轮询查询失败:', error);
    setIsRotating('-1');
  }, []);

  const onStop = React.useCallback(() => {
    console.log('轮询已停止');
    setIsRotating('0');
  }, []);

  // 使用轮询 Hook
  const { start: startPolling, stop: stopPolling } = usePolling(myQuery, {
    interval: 5000, // 5秒轮询间隔
    immediate: false, // 不立即执行，等待手动触发
    // maxRetries: 3, // 最大重试30次（1分钟）
    onSuccess,
    onError,
    onStop,
  });

  // 开始轮询的函数
  const qryRotating = React.useCallback(() => {
    setIsRotating('1');
    startPolling();
  }, [startPolling]);

  React.useEffect(() => {
    console.log('isLastMessageItem:', isLastMessageItem);
    if (isLastMessageItem) {
      qryRotating();
    } else {
      setIsRotating('0');
    }

    return () => {
      // 组件卸载时停止轮询
      stopPolling();
      try {
        if (abortControllerRef.current && !abortControllerRef.current?.signal.aborted) {
          abortControllerRef.current.abort('abort');
          abortControllerRef.current = null;
        }
      } catch (e) {
        console.error(e);
      }
    };
  }, [isLastMessageItem, qryRotating, stopPolling]);

  return (
    <>
      {isRotating === '1' && (
        <div className="ub ub-ac gap4">
          {intl.formatMessage({ id: 'tools.processing' })}
          <WaveBallLoading style={{ width: 20, height: 20, opacity: 0.6 }} />
        </div>
      )}
      {isRotating === '0' && (
        <div className="ub ub-ac gap4">
          <CheckCircleOutlined style={{ color: 'var(--beyond-color-success)', fontSize: 14 }} />
          {intl.formatMessage({ id: 'common.completed' })}
        </div>
      )}
      {isRotating === '-1' && <p>{intl.formatMessage({ id: 'common.executionFailed' })}</p>}
    </>
  );
}

export default Tools;
