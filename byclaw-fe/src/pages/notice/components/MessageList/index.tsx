import { DownOutlined } from '@ant-design/icons';
import { Button, Spin } from 'antd';
import classnames from 'classnames';
import { head, isEmpty, last, debounce } from 'lodash';
import React, { forwardRef, useCallback, useImperativeHandle } from 'react';
// @ts-ignore
import InfiniteScroll from '@/components/InfiniteScroll';

import useToBottomBtn from './hooks/useToBottomBtn';
import useRender from './useRender';
import DividerTips from './components/DividerTips';
import SystemTips from './components/SystemTips';

import { generateUniqueId } from '@/utils/math';

import type { IMessage } from '@/typescript/message';
import styles from './index.module.less';
import useGlobal from '@/hooks/useGlobal';

type IProps = {
  onNext?: (isPrev?: boolean) => void;
  messageList: Array<IMessage>;
  inverse?: boolean;
  hasMore?: boolean;

  showToBottomBtn?: boolean;
  updateMessage: (message: IMessage) => void;
  deleteMessage: (message: IMessage) => void;
};

const emptyArr: Array<IMessage> = [];

export interface IMessageListContext {
  messageListId: string;
}

export const MessageListContext = React.createContext<IMessageListContext>({
  messageListId: '',
});

const scrollThreshold = 50;

function MessageList(props: IProps, ref: any) {
  const {
    messageList = emptyArr,
    hasMore = false,
    inverse = true,
    showToBottomBtn = true,
    updateMessage,
    deleteMessage,
    onNext,
  } = props;

  const { EventEmitter } = useGlobal();

  const infiniteScrollRef = React.useRef<InfiniteScroll>(null);
  const scrollMessageDomId = React.useRef<string>(`notice_scrollMessage_${generateUniqueId()}`);

  const { renderMessage } = useRender({
    updateMessage,
    deleteMessage,
  });
  const { toBottomBtnVisable, setToBottomBtnVisable } = useToBottomBtn({
    messageList,
    scrollMessageId: scrollMessageDomId.current,
  });
  const bottomMsgItem = last(messageList);

  React.useEffect(() => {
    const h = () => {
      requestIdleCallback(
        debounce(() => {
          const scrollerElement = document.getElementById(scrollMessageDomId.current);
          if (scrollerElement) {
            scrollerElement.scrollTop = scrollerElement.scrollHeight;
          }
        }, 100)
      );
    };
    EventEmitter.on('scrollToMsgOnSessionChanged', h);
    return () => {
      EventEmitter.off('scrollToMsgOnSessionChanged', h);
    };
  }, []);

  const toBottom = useCallback(() => {
    infiniteScrollRef.current?.scrollToBottom();
    setToBottomBtnVisable(false);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      toBottom,
    }),
    []
  );

  return (
    <div className="full-height full-width" style={{ position: 'relative' }}>
      <MessageListContext.Provider value={{ messageListId: scrollMessageDomId.current }}>
        <div
          className={classnames(styles.messageContent, 'full-height full-width hideThumb')}
          id={scrollMessageDomId.current}
        >
          <InfiniteScroll
            ref={infiniteScrollRef}
            hasMore={hasMore}
            next={(isPrev?: boolean) => {
              onNext?.(isPrev);
            }}
            loader={
              <div className="ub ub-ac ub-pc">
                <Spin />
              </div>
            }
            dataLength={messageList.length}
            scrollableTarget={scrollMessageDomId.current}
            inverse={inverse}
            className={classnames(styles.messageRowWrap)}
            scrollThreshold={`${scrollThreshold}px`}
            hasChildren={messageList.length > 0}
            topItemKey={head(messageList)?.msgId}
            bottomItemKey={bottomMsgItem?.updateKey || bottomMsgItem?.msgId}
            style={{
              overflow: 'visible',
            }}
            appendItemsAutoScrollBottom={false}
          >
            {messageList.map((msg, idx, arr) => {
              const { msgId, isHide, fromBeyond } = msg;
              const { usage, text } = msg;

              if (isHide) return null;

              const isDividerTips = `${usage}` === '3';
              const isSystemTips = `${usage}` === '5';

              if (!isDividerTips && !isSystemTips && isEmpty(msg?.messageList) && fromBeyond) return null;

              return (
                <div
                  key={`${msgId}_wrapper`}
                  className={classnames('ub ub-pa mW900', styles.msgWrapper)}
                  id={`notice_wrapper_${msgId}`}
                  style={{ zIndex: arr.length - idx, position: 'relative' }}
                >
                  <div className="ub-f1 mW850">
                    {isDividerTips && <DividerTips text={text} />}
                    {isSystemTips && <SystemTips text={text} />}
                    {!isDividerTips && !isSystemTips && renderMessage(msg)}
                  </div>
                </div>
              );
            })}
          </InfiniteScroll>
        </div>
      </MessageListContext.Provider>
      {toBottomBtnVisable && showToBottomBtn && (
        <div className={classnames(styles.toBottomBtn, 'pointer')}>
          <Button
            icon={<DownOutlined />}
            shape="circle"
            onClick={() => {
              toBottom();
            }}
          />
        </div>
      )}
    </div>
  );
}

export default forwardRef(MessageList);
