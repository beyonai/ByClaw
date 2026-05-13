import React, { useState, useMemo, useRef, useEffect, memo } from 'react';
import classNames from 'classnames';
import dayjs from 'dayjs';

import { useDispatch, useIntl, useSelector } from '@umijs/max';
import { Divider, Input, Skeleton, Spin, Drawer } from 'antd';
import { trim, debounce, reduce, isNumber, set, get } from 'lodash';
import { SearchOutlined } from '@ant-design/icons';

import DialogueCard from './DialogueCard';
import EmptyTips from '@/components/EmptyTips';
import InfiniteScroll from '@/components/InfiniteScroll';
import useDialogue from '@/layout/sider/components/DialogueList/useDialogue';
import { getDisplayUserNameInChat } from '@/utils/chat';

import { SessionType } from '@/constants/session';
import { ISession } from '@/typescript/session';

import styles from './index.module.less';

const DEFAULT_PAGE_SIZE = 20;

const SessionDrawer = (props: { open: boolean; onClose: () => void }) => {
  const { open, onClose } = props;

  const intl = useIntl();
  const dispatch = useDispatch();

  const scrollDialogueListRef = useRef<HTMLDivElement>(null);

  const [tabKey] = useState(SessionType.all);
  const [isLoading, setIsLoading] = useState(false);
  const [canShow, setCanShow] = useState(false);

  const { userInfo } = useSelector(({ user }: any) => ({
    userInfo: user.userInfo,
  }));

  const getSearch = React.useCallback(
    debounce((tabKey: SessionType, searchKey?: string) => {
      if (isLoading) return;

      setIsLoading(true);
      const result = dispatch({
        type: 'session/querySessionList',
        payload: {
          pageNum: 1,
          pageSize: DEFAULT_PAGE_SIZE,
          searchKeyword: searchKey,
          sessionType: tabKey,
        },
      }) as any;
      if (typeof result?.finally === 'function') {
        result.finally(() => {
          setIsLoading(false);
        });
      } else {
        setIsLoading(false);
      }
    }, 300),
    []
  );

  const {
    currentList,
    currentPagination,
    hasMore,

    searchName,
    setSearchName,
  } = useDialogue({
    tabKey,
    getSearch,
  });

  const { pageSize, pageIndex } = currentPagination;
  const showEmpty = currentList && currentList.length === 0;

  const sessionGroupList: Record<string, ISession[]> = useMemo(() => {
    return reduce(
      currentList,
      (result, item) => {
        const myUpdateTimeStr = Number(item.updateTime) ? Number(item.updateTime) : item.updateTime;
        const myCreateTime = Number(item.createTime) ? Number(item.createTime) : item.createTime;

        let timeStr: number | string = myUpdateTimeStr;
        if (isNumber(timeStr) && timeStr < 0) {
          timeStr = myCreateTime;
        }

        const displayCreateTime = timeStr;
        if (!displayCreateTime) return result;

        const createTimeDayjsObj = dayjs(displayCreateTime);

        const isSameDay = createTimeDayjsObj.isSame(dayjs(), 'day');
        const isSameYear = createTimeDayjsObj.isSame(dayjs(), 'year');

        let key = '';
        if (isSameDay) {
          key = intl.formatMessage({ id: 'common.today' });
        } else if (isSameYear) {
          key = createTimeDayjsObj.format('MM-DD');
        } else {
          key = createTimeDayjsObj.format('YYYY-MM-DD');
        }

        const l: ISession[] = get(result, key, []);
        l.push(item);
        set(result, key, l);

        return result;
      },
      {}
    );
  }, [currentList]);

  useEffect(() => {
    if (scrollDialogueListRef.current) {
      setCanShow(true);
    }
  }, []);

  return (
    <Drawer
      forceRender
      title=""
      placement="left"
      onClose={onClose}
      open={open}
      footer={null}
      rootClassName={styles.drawer}
      styles={{
        header: {
          display: 'none',
        },
      }}
      width="80%"
    >
      <div className={classNames('full-height full-width ub ub-ver', styles.dialogueList)}>
        <div className={styles.searchInput} style={{ marginBottom: '8px' }}>
          <Input
            variant="underlined"
            value={searchName}
            style={{ fontSize: '18px', fontWeight: 500 }}
            suffix={<SearchOutlined onClick={() => getSearch(tabKey, searchName)} style={{ fontSize: '18px' }} />}
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
              getSearch(tabKey, searchName);
            }}
          />
        </div>
        <Spin spinning={isLoading} wrapperClassName={classNames(styles.spin, styles.listWrapper, 'ub-f1')}>
          <div id="scrollDialogueList" className="ub-f1 overflow-auto hideThumb" ref={scrollDialogueListRef}>
            {canShow && (
              <InfiniteScroll
                next={() => {
                  dispatch({
                    type: 'session/querySessionList',
                    payload: { pageNum: pageIndex + 1, pageSize, sessionType: tabKey, searchKeyword: searchName },
                  });
                }}
                hasMore={hasMore}
                loader={
                  <Skeleton
                    avatar={{ size: 'default', shape: 'circle' }}
                    paragraph={false}
                    active
                    style={{ padding: 8 }}
                  />
                }
                dataLength={currentList.length}
                scrollableTarget="scrollDialogueList"
                inverse={false}
                className={styles.messageRowWrap}
                scrollThreshold="50px"
                hasChildren={currentList.length > 0}
                endMessage={
                  currentList.length > 0 && (
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
                {showEmpty && (
                  <EmptyTips
                    icon="💬"
                    title={intl.formatMessage({ id: 'dialogueRecord.listTitle' })}
                    description={intl.formatMessage({ id: 'dialogueRecord.listTip' })}
                  />
                )}
                {Object.entries(sessionGroupList).map(([key, value]) => {
                  return (
                    <div key={key} className={styles.sessionGroup}>
                      <div className={styles.sessionGroupTitle}>{key}</div>
                      {value.map((item: ISession) => {
                        return <DialogueCard key={item.sessionId} item={item} onClose={onClose} />;
                      })}
                    </div>
                  );
                })}
              </InfiniteScroll>
            )}
          </div>
        </Spin>

        <div className="ub ub-ac gap8" style={{ marginTop: '16px' }}>
          <div className={styles.userName}>{getDisplayUserNameInChat(userInfo.userName)}</div>
          {userInfo.userName}
        </div>
      </div>
    </Drawer>
  );
};

export default memo(SessionDrawer);
