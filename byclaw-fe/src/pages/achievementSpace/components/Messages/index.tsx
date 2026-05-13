import React from 'react';
import classnames from 'classnames';
// @ts-ignore
import { useIntl } from '@umijs/max';
import useModal from '@/hooks/useModal';
import { Spin } from 'antd';

import { orderBy, noop, head, last } from 'lodash';

import InfiniteScroll from '@/components/InfiniteScroll';
import useRender from '@/components/MessageList/useRender';
import { createMessage, fetchMessageHandler } from '@/utils/messgae';
import { getChatHistory } from '@/service/message';

import styles from './index.module.less';
import { IMessage } from '@/typescript/message';

function Messages({ chatId, setChatId }: { chatId: string; setChatId: React.Dispatch<React.SetStateAction<string>> }) {
  const intl = useIntl();
  const { ModalNode, open, setOpen, setMyContent } = useModal({
    title: intl.formatMessage({ id: 'achievementSpace.viewMessage' }),
    modalClassName: styles.modal,
  });

  const { renderMessage } = useRender({
    updateMessage: noop,
    deleteMessage: noop,
  });

  const messageListContent = React.useCallback((messageList: IMessage[]) => {
    return (
      <div
        className={classnames('full-height full-width hideThumb', styles.messageContent)}
        id="citeScrollMessage"
        style={{
          pointerEvents: 'none',
        }}
      >
        <InfiniteScroll
          next={noop}
          hasMore={false}
          loader={null}
          dataLength={messageList.length}
          scrollableTarget="citeScrollMessage"
          inverse
          hasChildren={messageList.length > 0}
          topItemKey={head(messageList)?.msgId}
          bottomItemKey={last(messageList)?.msgId}
          style={{ overflow: 'visible' }}
          className={styles.infiniteScroll}
        >
          {messageList.map((msg) => {
            return renderMessage(msg, {
              hideAction: true,
              hideThinking: true,
            });
          })}
        </InfiniteScroll>
      </div>
    );
  }, []);

  React.useEffect(() => {
    setMyContent(null);
    if (!chatId) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setMyContent(<Spin spinning className={classnames(styles.spinningWrapper, 'ub ub-ac ub-pc')} />);
    getChatHistory({
      id: chatId,
    })
      .then((list) => {
        const messageList = orderBy(list, ['messageId'], ['asc']).map((item) => {
          const myMessage = fetchMessageHandler(item);

          return createMessage(myMessage);
        });

        setMyContent(messageListContent(messageList));
      })
      .catch(() => {
        setMyContent(null);
      });
  }, [chatId]);

  React.useEffect(() => {
    if (!open) {
      setChatId('');
    }
  }, [open]);

  return <>{ModalNode}</>;
}

export default Messages;
