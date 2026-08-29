import { DownOutlined } from '@ant-design/icons';
import { Button, Checkbox, Spin } from 'antd';
import classnames from 'classnames';
import { head, last, pullAll, uniq, isEmpty } from 'lodash';
import React, { forwardRef, useCallback, useImperativeHandle } from 'react';

import { IMessageState } from '@/constants/message';
import { multiChoicesHandler, checkAnswerMessageCanMemory } from '@/utils/messgae';
import useToBottomBtn from './hooks/useToBottomBtn';
import useRender from './useRender';
import DividerTips from './components/DividerTips';
import SystemTips from './components/SystemTips';
import MessageInfiniteScroll from './components/MessageInfiniteScroll';
import ConversationNavigator from './components/ConversationNavigator';

import { generateUniqueId } from '@/utils/math';

import type { IMultiChoicesType } from '@/components/ChatLayoutComp/hooks/useEventEmitterHooks';
import type { IMessage } from '@/typescript/message';
import styles from './index.module.less';
import useLocateMsg from './hooks/useLocateMsg';

type IProps = {
  onNext?: (isPrev?: boolean) => any;
  messageList: Array<IMessage>;
  hasMore: boolean;
  inverse?: boolean;
  sessionId?: string;

  multiChoicesList?: IMultiChoicesType[];
  multiChoicesMsgId?: string[];
  setMultiChoicesMsgId?: React.Dispatch<React.SetStateAction<string[]>>;

  hideAction?: boolean;
  previewInDetailPanel?: boolean;
  showToBottomBtn?: boolean;
  updateMessage: (message: IMessage) => IMessage;
  deleteMessage: (message: IMessage) => void;
  enableConversationNavigator?: boolean;
};

const emptyArr: Array<unknown> = [];

export interface IMessageListContext {
  messageListId: string;
  messageList: Array<IMessage>;
}

export const MessageListContext = React.createContext<IMessageListContext>({
  messageListId: '',
  messageList: emptyArr as IMessage[],
});

const scrollThreshold = 50;

type MessageRowProps = {
  msg: IMessage;
  index: number;
  messageCount: number;
  choicesMessageList: IMessage[];
  isMultiChoices: boolean;
  multiChoicesList: IMultiChoicesType[];
  multiChoicesMsgId?: string[];
  setMultiChoicesMsgId?: React.Dispatch<React.SetStateAction<string[]>>;
  hideAction?: boolean;
  renderMessage: (
    message: IMessage,
    param?: { showRelatedQuestions?: boolean; hideAction?: boolean; hideThinking?: boolean }
  ) => React.ReactNode;
};

const MessageRow = React.memo(function MessageRow({
  msg,
  index,
  messageCount,
  choicesMessageList,
  isMultiChoices,
  multiChoicesList,
  multiChoicesMsgId,
  setMultiChoicesMsgId,
  hideAction,
  renderMessage,
}: MessageRowProps) {
  const { msgId, messageState, fromBeyond, isHide, usage, text } = msg;

  if (isHide) return null;

  const isChecked = multiChoicesMsgId?.includes(msgId) && isMultiChoices;
  const isDividerTips = `${usage}` === '3';
  const isSystemTips = `${usage}` === '5';
  const isMemoryMode = multiChoicesList.includes('memory');
  let showMultiChoicesBox = isMultiChoices;

  if (isMemoryMode) {
    showMultiChoicesBox = false;
    if (fromBeyond) {
      showMultiChoicesBox = checkAnswerMessageCanMemory(msg);
    }
  }

  return (
    <div
      key={`${msgId}_wrapper`}
      className={classnames('ub ub-pa mW900', styles.msgWrapper, {
        [styles.msgWrapperSelected]: isChecked,
      })}
      id={`wrapper_${msgId}`}
      style={{ zIndex: messageCount - index, position: 'relative' }}
    >
      {showMultiChoicesBox && (
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
                setMultiChoicesMsgId?.((prevList) =>
                  uniq([...prevList, ...multiChoicesHandler(msg, index, choicesMessageList)])
                );
              } else {
                setMultiChoicesMsgId?.((prevList) => {
                  if (isMemoryMode) {
                    const answer = choicesMessageList[index + 1];
                    if (answer?.fromBeyond) {
                      return [...pullAll(prevList, [msgId, answer.msgId])];
                    }
                  }
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
            showRelatedQuestions: messageCount === index + 1,
            hideAction: isMultiChoices || hideAction,
          })}
      </div>
    </div>
  );
});

function MessageList(props: IProps, ref: any) {
  const {
    onNext,
    messageList = emptyArr as IMessage[],
    hasMore = false,
    inverse = true,
    showToBottomBtn = true,
    updateMessage,
    deleteMessage,
    sessionId,
    hideAction,
    previewInDetailPanel = false,
    enableConversationNavigator = false,
  } = props;
  const { multiChoicesList = emptyArr, setMultiChoicesMsgId, multiChoicesMsgId } = props;

  const infiniteScrollRef = React.useRef<MessageInfiniteScroll>(null);
  const scrollMessageDomId = React.useRef<string>(`scrollMessage_${generateUniqueId()}`);

  const { renderMessage, extendsRender } = useRender({
    updateMessage,
    deleteMessage,
    sessionId,
    previewInDetailPanel,
  });
  const { toBottomBtnVisable, setToBottomBtnVisable } = useToBottomBtn({
    messageList,
    scrollMessageId: scrollMessageDomId.current,
  });
  const bottomMsgItem = last(messageList);
  const isMultiChoices = !isEmpty(multiChoicesList);

  const { lowestPageNum } = useLocateMsg({
    sessionId,
    infiniteScrollRef,
    scrollThreshold,
    scrollTargeEleId: scrollMessageDomId.current,
    messageListLength: messageList.length,
    bottomItemKey: bottomMsgItem?.updateKey || bottomMsgItem?.msgId,
  });

  const toBottom = useCallback((params?: { behavior?: ScrollBehavior }) => {
    infiniteScrollRef.current?.scrollToBottom(params);
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
      <MessageListContext.Provider value={{ messageList, messageListId: scrollMessageDomId.current }}>
        <div
          className={classnames(styles.messageContent, 'full-height full-width hideThumb')}
          id={scrollMessageDomId.current}
        >
          <MessageInfiniteScroll
            ref={infiniteScrollRef}
            next={(isPrev?: boolean) => onNext?.(isPrev)}
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
            {messageList.map((msg, idx) => (
              <MessageRow
                key={`${msg.msgId}_wrapper`}
                msg={msg}
                index={idx}
                messageCount={messageList.length}
                choicesMessageList={isMultiChoices ? messageList : (emptyArr as IMessage[])}
                isMultiChoices={isMultiChoices}
                multiChoicesList={multiChoicesList}
                multiChoicesMsgId={multiChoicesMsgId}
                setMultiChoicesMsgId={setMultiChoicesMsgId}
                hideAction={hideAction}
                renderMessage={renderMessage}
              />
            ))}
          </MessageInfiniteScroll>
        </div>
      </MessageListContext.Provider>
      {enableConversationNavigator && sessionId && (
        <ConversationNavigator
          sessionId={sessionId}
          messageList={messageList}
          scrollContainerId={scrollMessageDomId.current}
          onLoadedMessageClick={() => {
            if (infiniteScrollRef.current) {
              infiniteScrollRef.current.isLastScrollAtBottom = false;
            }
          }}
        />
      )}
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
