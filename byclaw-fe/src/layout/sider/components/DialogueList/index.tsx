import React, { useState } from 'react';

import { SearchOutlined } from '@ant-design/icons';
// @ts-ignore
import { useDispatch, useIntl } from '@umijs/max';
import { Divider, Input, Skeleton, Spin } from 'antd';
import { trim, debounce } from 'lodash';

import classNames from 'classnames';
import InfiniteScroll from '@/components/InfiniteScroll';
import { ISession } from '@/typescript/session';
import DialogueCard from './DialogueCard';
import useDialogue from './useDialogue';
import { SessionType } from '@/constants/session';
import EmptyTips from '@/components/EmptyTips';
import styles from './index.module.less';
// import AntdIcon from '@/components/AntdIcon';
// import useGlobal from '@/hooks/useGlobal';
// import book from '@/assets/Book.svg';

const cannotActionListMap: Record<string, string[]> = {
  Notification: ['delete', 'edit'],
  default: [],
};

const DEFAULT_PAGE_SIZE = 20;

const DialogueList: React.FC = () => {
  const intl = useIntl();
  const dispatch = useDispatch();
  // const navigate = useNavigate();
  // const { sessionId } = useGlobal();

  const [tabKey] = useState(SessionType.all);
  const [isLoading, setIsLoading] = useState(false);
  // 发起群聊
  // const [showGroupChatModal, setShowGroupChatModal] = useState(false);
  // 发起单聊
  // const [showSingleChatModal, setShowSingleChatModal] = useState(false);

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
  // const handleOpenAchievement = () => {
  //   navigate('/achievementSpace', { state: { sessionId } });
  // };

  return (
    <div className={styles.dialogueList}>
      {/* <div className="ub ub-pj" style={{ padding: '6px 0 16px' }}>
        <span style={{ fontWeight: 'bold' }}>会话管理</span>
        <FilterOutlined className="pointer disabled" />
      </div> */}
      {/* <div className={styles.quickEntry}>
        <div
          className={classNames(styles.quickButton, 'ub ub-ac ub-pj pointer')}
          style={{ background: 'linear-gradient(90deg, #1882ff0f 0%, #36ebca0f 100%)' }}
          onClick={handleOpenAchievement}
        >
          <img src={book} alt="book" width={15} style={{ marginRight: 2 }} />
          <span className={styles.quickButtonText}>{intl.formatMessage({ id: 'sider.achievementSpace' })}</span>
          <AntdIcon type="icon-a-Arrow-rightjiantouyou" style={{ fontSize: 16, marginLeft: 'auto' }} />
        </div>
      </div> */}
      <div className={styles.searchInput}>
        <Input
          // disabled
          value={searchName}
          suffix={<SearchOutlined onClick={() => getSearch(tabKey, searchName)} />}
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
        {/* <Popover
          placement="bottom"
          trigger={['click', 'hover']}
          content={
            <div className="ub gap8">
              <div
                onClick={() => setShowSingleChatModal(true)}
                className={classNames('ub ub-ver ub-ac gap4 pointer', styles.createChatGroup)}
              >
                <AntdIcon type="icon-duihua1" className="primary" />
                <div>{intl.formatMessage({ id: 'personnelModel.contacts' })}</div>
              </div>
              <div
                onClick={() => setShowGroupChatModal(true)}
                className={classNames('ub ub-ver ub-ac gap4 pointer', styles.createChatGroup)}
              >
                <AntdIcon type="icon-a-Peoplesrenqun1" className="primary" />
                <div>{intl.formatMessage({ id: 'groupchat.create' })}</div>
              </div>
            </div>
          }
        >
          <div className={styles.createChat}>
            <AntdIcon type="icon-a-Plusjia" />
          </div>
        </Popover> */}
      </div>

      <Spin spinning={isLoading} wrapperClassName={classNames(styles.spin, 'ub-f1')}>
        {/* <div className={classNames('ub mb-8', styles.dialogueTab)}>
          {tabInfo.map((tabItem) => (
            <div
              className={classNames(styles.dialogueTabItem, { [styles.active]: tabKey === tabItem.key })}
              key={tabItem.key}
              onClick={() => setTabKey(tabItem.key)}
            >
              {intl.formatMessage({ id: tabItem.name })}
              {tabItem.unreadCount > 0 && <span className={styles.unreadCount}>{tabItem.unreadCount}</span>}
            </div>
          ))}
        </div> */}
        <div id="scrollDialogueList" className="ub-f1 overflow-auto hideThumb">
          <InfiniteScroll
            next={() => {
              dispatch({
                type: 'session/querySessionList',
                payload: { pageNum: pageIndex + 1, pageSize, sessionType: tabKey, searchKeyword: searchName },
              });
            }}
            hasMore={hasMore}
            loader={
              <Skeleton avatar={{ size: 'default', shape: 'circle' }} paragraph={false} active style={{ padding: 8 }} />
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
            {(currentList || []).map((item: ISession) => {
              const cannotActionList: string[] =
                cannotActionListMap[item.objectType || 'default'] || cannotActionListMap.default;

              return <DialogueCard key={item.sessionId} item={item} cannotActionList={cannotActionList} />;
            })}
          </InfiniteScroll>
        </div>
      </Spin>
    </div>
  );
};

export default DialogueList;
  
