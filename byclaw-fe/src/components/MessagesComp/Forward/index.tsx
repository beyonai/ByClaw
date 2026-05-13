import React from 'react';
import { debounce, noop, head, last, get, orderBy, isFunction } from 'lodash';
import classnames from 'classnames';
import { useIntl, useSelector } from '@umijs/max';
import { Spin } from 'antd';

import { getForwardMessage } from '@/service/message';
import useRender from '@/components/MessageList/useRender';
import InfiniteScroll from '@/components/InfiniteScroll';
import useModal from '@/hooks/useModal';
import { createMessage, fetchMessageHandler } from '@/utils/messgae';

import { getResponseAgentInfo } from '@/components/MessageList/utils';

import type { IMessage } from '@/typescript/message';
import type { IState as useEmployeesIState } from '@/models/useEmployees';

import styles from './index.module.less';
import { getSystemConfigByStorage } from '@/utils/system';

export const cannotClickList = [
  '2001',
  '2002',
  '2003',
  '2004',
  '2005',
  '2006',
  '2007',
  '2008',
  '2009',
  '2010',
  '2011',
  '2012',
  '2013',
  '2014',
  '2015',
];

type IForwardMsgList = IMessage[];

export type IMessageListItemContent = {
  substance: IForwardMsgList | null;
};

export type IProps = {
  // eslint-disable-next-line react/no-unused-prop-types
  message: IMessage;
  updateMessageListItemContent: (messageListItemContent: IMessageListItemContent) => void;
  messageListItemContent: IMessageListItemContent;
};

function Forward(props: IProps) {
  const { message, messageListItemContent, updateMessageListItemContent } = props;
  const { messageId } = message;
  const { substance } = messageListItemContent;

  const forwardScrollMessageRef = React.useRef<HTMLDivElement>(null);
  const eventRef = React.useRef(noop);
  const abortController = React.useRef<AbortController>(undefined);

  const intl = useIntl();

  const { employeesList, agentList }: useEmployeesIState = useSelector(
    ({ employees }: { employees: useEmployeesIState }) => ({
      ...employees,
    })
  );

  const [canShow, setCanShow] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(!substance);

  const avatarCardItemRef = React.useRef<HTMLDivElement>(null);

  const { ModalNode, setOpen, setMyContent } = useModal({
    title: intl.formatMessage({ id: 'forward.forwardMessage' }),
    modalClassName: styles.modal,
  });

  const hasInit = substance !== null;

  React.useEffect(() => {
    if (!avatarCardItemRef.current || canShow || hasInit) return noop;

    let observer: any;

    const callback = debounce((entries: IntersectionObserverEntry[]) => {
      entries.forEach((entry) => {
        if (entry.intersectionRatio > 0) {
          // 元素进入可视区域
          setCanShow(true);
          observer?.disconnect();
        } else {
          // 元素离开可视区域
        }
      });
    }, 300);

    observer = new IntersectionObserver(callback);
    observer.observe(avatarCardItemRef.current);
    return () => {
      observer.disconnect();
    };
  }, [canShow, hasInit]);

  React.useEffect(() => {
    if (!canShow || !messageId || hasInit) return;

    abortController.current = new AbortController();

    getForwardMessage(messageId, abortController.current)
      .then((res) => {
        const cacheList = orderBy(get(res, '0.forwardMsgList') || [], ['messageId'], ['asc']).map((item) => {
          const myMessage = fetchMessageHandler(item);

          return createMessage({
            ...myMessage,
            sessionId: `${res.sessionId}`,
          });
        });

        updateMessageListItemContent({
          substance: cacheList,
        });
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [canShow, messageId, hasInit]);

  const { renderMessage } = useRender({
    updateMessage: noop,
    deleteMessage: noop,
  });

  const addEvent = React.useCallback(() => {
    const h = (e: any) => {
      e.preventDefault();
      e.stopPropagation();
    };

    setTimeout(() => {
      forwardScrollMessageRef.current?.querySelectorAll('div[data-comptype]').forEach((item) => {
        if (cannotClickList.includes(`${item?.dataset?.comptype}`)) {
          item.addEventListener('click', h);
        }
      });
    }, 100);

    return () => {
      forwardScrollMessageRef.current?.querySelectorAll('div[data-comptype]').forEach((item) => {
        item.removeEventListener('click', h);
      });
    };
  }, []);

  const messageListContent = React.useCallback((messageList: IMessage[] | null) => {
    if (!messageList) return null;

    if (isFunction(eventRef.current)) {
      eventRef.current();
    }
    eventRef.current = addEvent();

    return (
      <div
        className={classnames('full-height full-width hideThumb', styles.messageContent)}
        id="forwardScrollMessage"
        ref={forwardScrollMessageRef}
      >
        <InfiniteScroll
          next={noop}
          hasMore={false}
          loader={null}
          dataLength={messageList.length}
          scrollableTarget="forwardScrollMessage"
          inverse
          className=""
          hasChildren={messageList.length > 0}
          topItemKey={head(messageList)?.msgId}
          bottomItemKey={last(messageList)?.msgId}
          style={{ overflow: 'visible' }}
        >
          {messageList.map((msg) => {
            return renderMessage(msg, {
              hideAction: true,
              hideThinking: false,
            });
          })}
        </InfiniteScroll>
      </div>
    );
  }, []);

  React.useEffect(() => {
    return () => {
      if (!abortController.current || abortController.current?.signal.aborted) return;

      abortController.current?.abort?.();
    };
  }, []);

  return (
    <>
      <div
        className={classnames(styles.Forward, 'hideThumb')}
        ref={avatarCardItemRef}
        onClick={() => {
          if (!substance) return;

          setMyContent(messageListContent(substance));
          setOpen(true);
        }}
      >
        <Spin spinning={isLoading} wrapperClassName={styles.spin}>
          <div className="ub ub-ver gap4 pointer">
            {(substance || []).map((item) => {
              const { text, creatorName, fromBeyond, fromOtherUser } = item;

              // eslint-disable-next-line prefer-const
              const agentInfo = getResponseAgentInfo({ employeesList, agentList }, item.metadata);
              const isLeftSide = fromBeyond || fromOtherUser;
              const isSuperAssistant = fromBeyond && !!agentInfo?.isSuperAssistant;

              let leftName: string;
              if (fromBeyond || isSuperAssistant) {
                leftName =
                  agentInfo?.name ||
                  getSystemConfigByStorage().title ||
                  intl.formatMessage({ id: 'messageList.defaultAIName' });
              } else {
                leftName = creatorName || intl.formatMessage({ id: 'common.user' });
              }

              return (
                <p className="textEllipsis" key={item.messageId || item.msgId || text}>{`${isLeftSide ? leftName : creatorName}: ${
                  text || intl.formatMessage({ id: 'forward.message' })
                }`}</p>
              );
            })}
          </div>
        </Spin>
      </div>
      {ModalNode}
    </>
  );
}
export default Forward;
