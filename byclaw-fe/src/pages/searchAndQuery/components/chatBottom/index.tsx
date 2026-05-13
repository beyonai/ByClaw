import React, { useEffect, useReducer, useCallback, useState } from 'react';
import { Skeleton, Card, Typography } from 'antd';
import classNames from 'classnames';
import { size } from 'lodash';
import { useDispatch } from '@umijs/max';

import { queryRecentlySearchAsk } from '@/service/session';

import ChatAvatar from '@/components/ChatAvatar';

import { getDefaultPagination, paginationReducer } from '@/utils/pageInfo';
import { sessionHandler } from '@/utils/session';
import InfiniteScroll from '@/components/InfiniteScroll';

import useGlobal from '@/hooks/useGlobal';

import { ISession } from '@/typescript/session';

import styles from './index.module.less';

const { Paragraph } = Typography;

const MySkeleton = () => {
  return <Skeleton.Node active style={{ height: 98, width: '100%' }} />;
};

const DialogueCard = ({ item }: { item: ISession }) => {
  const { setSessionId, EventEmitter } = useGlobal();

  const dispatch = useDispatch();

  return (
    <Card
      hoverable
      className={classNames(styles.dialogueCard, 'full-width')}
      onClick={() => {
        dispatch({
          type: 'session/addSession',
          payload: {
            ...item,
          },
        });

        setSessionId?.(`${item.sessionId}`);
        EventEmitter.emit('set-sider-active-key', 'searchAndQuery');
      }}
    >
      <div className="ub gap8 full-width">
        <ChatAvatar session={item} size={32} />
        <div className="ub-f1 ub ub-ac" style={{ fontWeight: 'bold' }}>
          <Paragraph ellipsis={{ rows: 2 }} style={{ marginBottom: 0, wordBreak: 'break-all' }}>
            {item.sessionName}
          </Paragraph>
        </div>
      </div>
      <p className="textEllipsis" style={{ color: 'var(--beyond-color-text-quaternary)', marginTop: 'auto' }}>
        {item.createTime}
      </p>
    </Card>
  );
};

const ChatBottom = () => {
  const { agentInfo } = useGlobal();

  const [paginationInfo, paginationDispatch] = useReducer(paginationReducer, getDefaultPagination({ pageSize: 30 }));

  const [conversationList, setConversationList] = useState<ISession[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const agentId = agentInfo?.agentId;

  const myQryConversations = useCallback(
    (pageNum: number) => {
      if (!agentId) return Promise.resolve();
      return queryRecentlySearchAsk({
        pageNum,
        pageSize: paginationInfo.pageSize,
        keyword: '',
        objectId: agentId,
      }).then((res) => {
        const { list, total, pageNum: newPageNum, totalPages } = res || {};
        const mySessionList: ISession[] = (list || []).map((item: ISession) => {
          return sessionHandler(item);
        });

        const updatedPagination = {
          ...paginationInfo,
          pageIndex: Number(newPageNum),
          pageCount: Number(totalPages),
          total: Number(total),
        };

        paginationDispatch({
          type: 'change',
          item: updatedPagination,
        });

        setConversationList((prevList) => {
          if (pageNum === 1) {
            return mySessionList;
          }
          return [...mySessionList, ...prevList];
        });
      });
    },
    [agentId]
  );

  useEffect(() => {
    setIsLoading(true);
    myQryConversations(1).finally(() => {
      setIsLoading(false);
    });
  }, [myQryConversations]);

  return (
    <div className={classNames(styles.chatBottom, 'ub ub-ver ub-f1')}>
      <p>最近搜问</p>
      {/*  */}
      <div
        className={classNames('full-height full-width overflow-auto hideThumb', styles.messageContent)}
        id="SQChatBottomScrollMessage"
      >
        {isLoading && (
          <div className={styles.cardsGrid}>
            <MySkeleton />
          </div>
        )}
        {!isLoading && (
          <InfiniteScroll
            next={() => {
              myQryConversations(paginationInfo.pageIndex + 1);
            }}
            hasMore={size(conversationList) < paginationInfo.total}
            loader={<MySkeleton />}
            dataLength={conversationList.length}
            scrollableTarget="SQChatBottomScrollMessage"
            inverse={false}
            className={styles.messageRowWrap}
            scrollThreshold="50px"
            hasChildren={conversationList.length > 0}
            style={{ overflow: 'visible' }}
          >
            <div className={styles.cardsGrid}>
              {(conversationList || []).map((item: ISession) => (
                <DialogueCard key={item.sessionId} item={item} />
              ))}
            </div>
          </InfiniteScroll>
        )}
      </div>
    </div>
  );
};

export default ChatBottom;
