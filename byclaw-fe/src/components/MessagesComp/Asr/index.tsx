import React, { useEffect, useState, useRef } from 'react';
import { get, noop, concat, cloneDeep, unset } from 'lodash';
import classnames from 'classnames';
import AntdIcon from '@/components/AntdIcon';
import { Spin } from 'antd';
// @ts-ignore
import { useIntl } from '@umijs/max';

import { getMessageById } from '@/service/message';

import useGlobal from '@/hooks/useGlobal';
import useAppStore from '@/models/common/useAppStore';
import useCollect from '@/hooks/useCollect';

import RecordingIcon from '@/components/QueryInput/components/STTComp/recordingIcon';

import { answerDeltaHandler } from '@/hooks/useSseSender/util';
import { SSEMessageType } from '@/constants/message';

import type { IMessage } from '@/typescript/message';

import styles from './index.module.less';
import { getToken } from '@/utils/auth';

export type IMessageListItemContent = {
  substance: {
    title: string;
    recordText?: string;

    url?: string;
    transcription?: string[];
    minute?: string;
    status?: 'recording' | 'summarizing' | 'finally';

    createdAt?: string;
    meetingNumber?: string;
  };
  summaryed?: boolean;
};

type Iprops = {
  message: IMessage;
  updateMessageListItemContent: (messageListItemContent: IMessageListItemContent) => void;
  messageListItemContent: IMessageListItemContent;
};

function Asr(props: Iprops) {
  const { message, messageListItemContent, updateMessageListItemContent } = props;

  const intl = useIntl();
  const { sessionId, EventEmitter } = useGlobal();
  const { setSiderCollapsed } = useAppStore();

  const { messageId, agentId, collectIds = [] } = message;
  const { substance } = messageListItemContent;
  const { title, url, minute, createdAt, meetingNumber } = substance;

  const hasUrl = !!url;
  const collectKey = `${SSEMessageType.asr}_${meetingNumber}`;
  const isCollected = (collectIds || []).includes(collectKey);

  const { collect, cancelCollect, collectLoading } = useCollect({
    messageId,
    collectKey,
    type: 'record',
    message,
    sessionId,
  });

  const setIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const [status, setStatus] = useState<
    'connecting' | 'recording' | 'summarizing' | 'finally' | 'init' | 'reconnecting'
  >(() => {
    // 优先使用接口返回的 status
    if (substance.status) {
      return substance.status;
    }

    // 兼容旧逻辑
    if (url) {
      return 'finally';
    }

    return 'recording';
  });

  const myUpdateMessageListItemContent = React.useCallback(
    (mysubstance: Partial<IMessageListItemContent['substance']> = {}) => {
      updateMessageListItemContent({
        ...messageListItemContent,
        substance: {
          ...substance,
          ...mysubstance,
        },
      });
    },
    [messageListItemContent, updateMessageListItemContent, substance]
  );

  useEffect(() => {
    // 如果已经有url（finally状态），或者没有messageId，则不轮询
    if (status === 'finally' || !messageId) return noop;

    const getMessage = async () => {
      console.log('会议纪要 getMessage');
      try {
        const res: any = await getMessageById({
          messageId,
        });
        const { data } = res;
        try {
          const messageStructObj = JSON.parse(data?.messageStruct);
          const list = concat([], messageStructObj);
          const asrCompData = list.find((item) => {
            const message = get(answerDeltaHandler(item), 'message');

            return `${message?.contentType}` === `${SSEMessageType.asr}`;
          });

          const contentStr = get(asrCompData, 'choices.0.delta.content', '');

          if (contentStr) {
            const content = JSON.parse(contentStr);
            console.log('content:', content, status);

            if (content.status === status) return;

            // 解码URL编码的title字段
            if (content.title && typeof content.title === 'string') {
              try {
                content.title = decodeURIComponent(content.title);
              } catch (error) {
                console.warn('解码title失败:', error);
                // 如果解码失败，保持原值
              }
            }

            setStatus(content.status);

            // 更新消息内容
            myUpdateMessageListItemContent(content);

            // 如果是 finally 状态且有 url，停止轮询
            if (content.status === 'finally' && content.url) {
              if (setIntervalRef.current) {
                clearInterval(setIntervalRef.current);
                setIntervalRef.current = null;
              }
            }
          }
        } catch (e) {
          console.error(e);
        }
      } catch (e) {
        console.error(e);
      }
    };

    setIntervalRef.current = setInterval(getMessage, 3000);

    return () => {
      if (setIntervalRef.current) {
        clearInterval(setIntervalRef.current);
        setIntervalRef.current = null;
      }
    };
  }, [messageId, status, myUpdateMessageListItemContent]);

  return (
    <div
      className={classnames(styles.asr, 'ub', {
        pointer: hasUrl,
      })}
      style={{ position: 'relative' }}
      onClick={() => {
        if (!hasUrl) return;

        const myUrl = new URL(url);

        myUrl.searchParams.set('token', getToken());

        EventEmitter.emit('beyond-minor-driver-open-type', {
          drawerType: 'iframe',
          canClose: true,
          canCloseContent: true,
        });
        EventEmitter.emit('beyond-minor-driver-message', {
          url: myUrl.toString(),
        });
        setSiderCollapsed(true);
      }}
    >
      {messageId && !!minute && (
        <>
          {collectLoading ? (
            <div className={styles.collectItem}>
              <Spin spinning size="small" />
            </div>
          ) : (
            <div
              className={classnames(styles.collect, styles.collectItem, 'ub pointer', {
                [styles.collected]: isCollected,
              })}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();

                if (isCollected) {
                  cancelCollect();
                } else {
                  const myMessageListItemContent = cloneDeep(messageListItemContent);

                  unset(myMessageListItemContent, 'substance.minute');
                  unset(myMessageListItemContent, 'substance.transcription');

                  collect({
                    agentId,
                    content: JSON.stringify(myMessageListItemContent),
                    name: title, // String，必填，名称，最大256字符
                  });
                }
              }}
            >
              <AntdIcon style={{ color: isCollected ? '#F7BA1E' : undefined }} type="icon-a-Starxingxing" />
            </div>
          )}
        </>
      )}
      <div className="ub gap8 ub-ver">
        {!hasUrl && ['recording', 'connecting', 'init', 'reconnecting'].includes(status) && (
          <div style={{ width: '20px', height: '20px' }}>
            <RecordingIcon />
          </div>
        )}
        {!hasUrl && status === 'summarizing' && (
          <span style={{ fontSize: '14px', color: 'var(--beyond-color-text-tertiary)' }}>
            {intl.formatMessage({ id: 'asr.generatingSummary' })}
          </span>
        )}
        {hasUrl && (
          <span style={{ fontSize: '14px', color: 'var(--beyond-color-text-tertiary)' }}>
            {intl.formatMessage({ id: 'asr.clickToViewMore' })}
          </span>
        )}
        <div className="ub gap2 ub-ver">
          <p style={{ fontSize: '14px', fontWeight: '500' }}>{decodeURIComponent(title)}</p>
          <p style={{ color: 'var(--beyond-color-text-tertiary)', fontSize: '12px' }}>
            {intl.formatMessage({ id: 'asr.meetingTime' })}：{createdAt}
          </p>
        </div>
      </div>
    </div>
  );
}

export default Asr;
