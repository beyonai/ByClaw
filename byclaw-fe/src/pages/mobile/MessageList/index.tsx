import { DownOutlined } from '@ant-design/icons';
import { Button, Spin, Checkbox } from 'antd';
import classnames from 'classnames';
import { head, last, size, uniq, pullAll } from 'lodash';
import React, { forwardRef, useCallback, useImperativeHandle } from 'react';
// @ts-ignore
import InfiniteScroll from '@/components/InfiniteScroll';

import { IMessageState } from '@/constants/message';

import useToBottomBtn from '@/components/MessageList/hooks/useToBottomBtn';
import useRender from './useRender';
import DividerTips from './components/DividerTips';
import SystemTips from './components/SystemTips';
import WelcomeTips from './components/WelcomeTips';

import { generateUniqueId } from '@/utils/math';
import { multiChoicesHandler } from '@/utils/messgae';

import type { IMessage } from '@/typescript/message';
import styles from './index.module.less';
import useLocateMsg from '@/components/MessageList/hooks/useLocateMsg';

type IProps = {
  onNext?: (isPrev?: boolean) => void;
  messageList: Array<IMessage>;
  hasMore: boolean;
  inverse?: boolean;
  sessionId?: string;

  isMultiChoices?: boolean;
  multiChoicesMsgId?: string[];
  setMultiChoicesMsgId?: React.Dispatch<React.SetStateAction<string[]>>;

  hideAction?: boolean;
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
    onNext,
    messageList = emptyArr,
    hasMore = false,
    inverse = true,
    showToBottomBtn = true,
    updateMessage,
    deleteMessage,
    sessionId,
    hideAction,
  } = props;
  const { isMultiChoices = false, setMultiChoicesMsgId, multiChoicesMsgId } = props;

  const infiniteScrollRef = React.useRef<InfiniteScroll>(null);
  const scrollMessageDomId = React.useRef<string>(`scrollMessage_${generateUniqueId()}`);

  const { renderMessage, extendsRender } = useRender({
    updateMessage,
    deleteMessage,
    sessionId,
  });
  const { toBottomBtnVisable, setToBottomBtnVisable } = useToBottomBtn({
    messageList,
    scrollMessageId: scrollMessageDomId.current,
  });
  const bottomMsgItem = last(messageList);

  const { lowestPageNum } = useLocateMsg({
    sessionId,
    infiniteScrollRef,
    scrollThreshold,
    scrollTargeEleId: scrollMessageDomId.current,
    messageListLength: messageList.length,
    bottomItemKey: bottomMsgItem?.updateKey || bottomMsgItem?.msgId,
  });

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
          {!sessionId && <WelcomeTips />}
          {sessionId && (
            <InfiniteScroll
              ref={infiniteScrollRef}
              next={(isPrev?: boolean) => {
                onNext?.(isPrev);
              }}
              hasMore={hasMore}
              loader={
                <div className="ub ub-ac ub-pc">
                  <Spin />
                </div>
              }
              dataLength={messageList.length}
              scrollableTarget={scrollMessageDomId.current}
              inverse={inverse}
              className={classnames(styles.messageRowWrap, { [styles.hasMore]: hasMore })}
              scrollThreshold={`${scrollThreshold}px`}
              hasChildren={messageList.length > 0}
              topItemKey={head(messageList)?.msgId}
              bottomItemKey={bottomMsgItem?.updateKey || bottomMsgItem?.msgId}
              style={{
                overflow: 'visible',
              }}
              lowestPageNum={lowestPageNum}
              appendItemsAutoScrollBottom={false}
            >
              {messageList.map((msg, idx, arr) => {
                const { msgId, messageState, fromBeyond, isHide } = msg;
                const { usage, text } = msg;

                if (isHide) return null;

                const isChecked = multiChoicesMsgId?.includes(msgId) && isMultiChoices;
                const isDividerTips = `${usage}` === '3';
                const isSystemTips = `${usage}` === '5';

                return (
                  <div
                    key={`${msgId}_wrapper`}
                    className={classnames('ub ub-pa mW900', styles.msgWrapper, {
                      [styles.msgWrapperSelected]: isChecked,
                    })}
                    id={`wrapper_${msgId}`}
                    style={{ zIndex: arr.length - idx, position: 'relative' }}
                  >
                    {isMultiChoices && (
                      <div
                        className={classnames('ub', {
                          'ub-ac': !fromBeyond,
                          'ub-as': fromBeyond,
                        })}
                        style={{ minWidth: 16, padding: '6px 12px 6px 0' }}
                      >
                        <Checkbox
                          value={msgId}
                          checked={isChecked}
                          disabled={![IMessageState.Done, IMessageState.Cancel].includes(messageState)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setMultiChoicesMsgId?.((prevList) => {
                                const list = [...prevList];

                                list.push(...multiChoicesHandler(msg, idx, arr));

                                return uniq(list);
                              });
                            } else {
                              setMultiChoicesMsgId?.((prevList) => {
                                return [...pullAll(prevList, [msgId])];
                              });
                            }
                          }}
                        />
                      </div>
                    )}

                    <div className="ub-f1 mW850" key={`${msgId}_msgContent`}>
                      {isDividerTips && <DividerTips text={text} />}
                      {isSystemTips && <SystemTips text={text} />}
                      {!isDividerTips &&
                        !isSystemTips &&
                        renderMessage(msg, {
                          showRelatedQuestions: size(arr) === idx + 1,
                          hideAction: isMultiChoices || hideAction,
                        })}
                    </div>
                  </div>
                );
              })}
            </InfiniteScroll>
          )}
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
      {extendsRender}
    </div>
  );
}

export default forwardRef(MessageList);
