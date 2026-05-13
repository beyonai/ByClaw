import React, { useCallback, useReducer } from 'react';

import { SearchOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import { Divider, Input, Skeleton, Spin } from 'antd';
import { trim, isEmpty, size } from 'lodash';

import classNames from 'classnames';
import InfiniteScroll from '@/components/InfiniteScroll';
import { qryConversations } from '@/service/layout';
import { ISession } from '@/typescript/session';
import { themes } from '@/constants/theme';
import { getRandomNumber } from '@/utils/math';
import { SessionType } from '@/constants/session';

import { getDefaultPagination, paginationReducer } from '@/utils/pageInfo';
import DialogueCard from '@/layout/sider/components/DialogueList/DialogueCard';
import EmptyTips from '@/components/EmptyTips';

import { formatSessionName } from '@/utils/session';

import styles from './index.module.less';

function SessionList({ onSelect }: { onSelect: (item: ISession) => void }) {
  const [list, setList] = React.useState<ISession[]>([]);
  const [searchName, setSearchName] = React.useState('');
  const [isLoading, setIsLoading] = React.useState<boolean>(false);

  const intl = useIntl();
  const [paginationInfo, paginationDispatch] = useReducer(paginationReducer, getDefaultPagination({ pageSize: 20 }));

  const { total } = paginationInfo;
  const hasMore = size(list) < total;

  const myQryConversations = useCallback(
    ({ pageIndex, searchKeyword }: { pageIndex: number; searchKeyword?: string }) => {
      setIsLoading(true);

      qryConversations({
        sessionType: [SessionType.group, SessionType.single],
        pageNum: pageIndex,
        pageSize: paginationInfo.pageSize,
        searchKeyword,
      })
        .then((res) => {
          const { list, total, pageNum: newPageNum, totalPages } = res || {};

          const mySessionList: ISession[] = (list || []).map((item: ISession) => {
            const payload = {
              ...item,
              sessionId: `${item.sessionId || ''}`,
              avatar: item.avatar ? item.avatar : 'beyond/session.png',
              theme: item.avatar ? undefined : themes[getRandomNumber(0, size(themes) - 1)],
              sessionName: formatSessionName(item),
            };

            return payload;
          });

          if (pageIndex === 1) {
            setList(mySessionList);
          } else {
            setList((prev) => [...prev, ...mySessionList]);
          }

          paginationDispatch({
            type: 'change',
            item: {
              pageIndex: newPageNum,
              total,
              pageCount: totalPages,
            },
          });
        })
        .finally(() => {
          setIsLoading(false);
        });
    },
    []
  );

  const getSearch = useCallback((searchKeyword?: string) => {
    myQryConversations({ pageIndex: 1, searchKeyword });
  }, []);

  React.useEffect(() => {
    getSearch();
  }, []);

  return (
    <div className={styles.dialogueList}>
      <Input
        className={styles.searchInput}
        // disabled
        value={searchName}
        suffix={<SearchOutlined onClick={() => getSearch(searchName)} />}
        placeholder={intl.formatMessage(
          {
            id: 'form.inputPlaceholder',
          },
          {
            content: intl.formatMessage({
              id: 'knowledgeDetail.keywords',
            }),
          }
        )}
        onChange={(e) => {
          setSearchName(trim(e.target.value));
        }}
        onPressEnter={() => {
          getSearch(searchName);
        }}
      />
      <Spin spinning={isLoading} wrapperClassName={classNames(styles.spin, 'ub-f1')}>
        <div id="allSessionList" className="ub-f1 overflow-auto hideThumb">
          <InfiniteScroll
            next={() => {
              console.log('next');
              myQryConversations({
                pageIndex: paginationInfo.pageIndex + 1,
              });
            }}
            hasMore={hasMore}
            loader={<Skeleton avatar paragraph={false} active />}
            dataLength={list.length}
            scrollableTarget="allSessionList"
            inverse={false}
            className={styles.messageRowWrap}
            scrollThreshold="50px"
            hasChildren={list.length > 0}
            endMessage={
              list.length > 0 && (
                <Divider plain>
                  {intl.formatMessage({ id: 'common.endMessage' })}{' '}
                  <span role="img" aria-label="emoji">
                    🤐
                  </span>
                </Divider>
              )
            }
            style={{ overflow: 'visible' }}
          >
            {isEmpty(list) && (
              <EmptyTips
                icon="💬"
                title={intl.formatMessage({ id: 'dialogueRecord.listTitle' })}
                description={intl.formatMessage({ id: 'dialogueRecord.listTip' })}
              />
            )}
            {(list || []).map((item: ISession) => (
              <DialogueCard
                key={item.sessionId}
                item={item}
                onSelect={onSelect}
                cannotActionList={['delete', 'edit']}
              />
            ))}
          </InfiniteScroll>
        </div>
      </Spin>
    </div>
  );
}

export default SessionList;
