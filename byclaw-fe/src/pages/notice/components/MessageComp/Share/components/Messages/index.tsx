import React, { useMemo } from 'react';
import classnames from 'classnames';
import { useIntl } from '@umijs/max';
import useModal from '@/hooks/useModal';
import { Spin } from 'antd';

import { orderBy, noop, head, last } from 'lodash';

import InfiniteScroll from '@/components/InfiniteScroll';
import useRender from '@/components/MessageList/useRender';
import { createMessage, fetchMessageHandler } from '@/utils/messgae';
import { getMessageByIds } from '@/service/message';
import useGlobal from '@/hooks/useGlobal';
import GlobalContext from '@/layout/components/provider/global';
import { LayoutMode } from '@/constants/system';

import styles from './index.module.less';
import { IMessage } from '@/typescript/message';

function Messages({
  messageIds,
  setMessageIds,
}: {
  messageIds: string;
  setMessageIds: React.Dispatch<React.SetStateAction<string>>;
}) {
  const intl = useIntl();

  const globalValue = useGlobal();

  const { ModalNode, open, setOpen, setMyContent } = useModal({
    title: intl.formatMessage({ id: 'notice.messageComp.share.viewMessage' }),
    modalClassName: styles.modal,
  });

  const { renderMessage } = useRender({
    updateMessage: noop,
    deleteMessage: noop,
  });

  const value = useMemo(() => {
    return {
      ...globalValue,
      layoutMode: LayoutMode.preview,
    };
  }, [globalValue]);

  const messageListContent = React.useCallback((messageList: IMessage[]) => {
    return (
      <GlobalContext.Provider value={value}>
        <div
          className={classnames('full-height full-width hideThumb', styles.messageContent)}
          id="shareScrollMessage"
          style={{
            pointerEvents: 'none',
          }}
        >
          <InfiniteScroll
            next={noop}
            hasMore={false}
            loader={null}
            dataLength={messageList.length}
            scrollableTarget="shareScrollMessage"
            inverse
            hasChildren={messageList.length > 0}
            topItemKey={head(messageList)?.msgId}
            bottomItemKey={last(messageList)?.msgId}
            style={{ overflow: 'visible' }}
            className={classnames(styles.infiniteScroll, 'ub ub-ver gap12')}
          >
            {messageList.map((msg) => {
              return renderMessage(msg, {
                hideAction: true,
                hideThinking: true,
              });
            })}
          </InfiniteScroll>
        </div>
      </GlobalContext.Provider>
    );
  }, []);

  React.useEffect(() => {
    setMyContent(null);
    if (!messageIds) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setMyContent(<Spin spinning className={classnames(styles.spinningWrapper, 'ub ub-ac ub-pc')} />);
    getMessageByIds({
      messageIds: messageIds.split(','),
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
  }, [messageIds]);

  React.useEffect(() => {
    if (!open) {
      setMessageIds('');
    }
  }, [open]);

  return <>{ModalNode}</>;
}

export default Messages;
