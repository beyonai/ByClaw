import React, { useEffect, useRef, useState } from 'react';

import { SearchOutlined } from '@ant-design/icons';
import { Divider, Dropdown, Input, Popconfirm, Space, Spin, Typography } from 'antd';
import classnames from 'classnames';
import dayjs from 'dayjs';
import { get } from 'lodash';
// @ts-ignore
import { useDispatch, useIntl, useNavigate, useSelector } from '@umijs/max';

import AntdIcon from '@/components/AntdIcon';
import InfiniteScroll from '@/components/InfiniteScroll';
import useGlobal from '@/hooks/useGlobal';
import useSearch from './useSearch';

import { UserState } from '@/models/common/user';
import { ISessionState } from '@/models/session';
import { ISession } from '@/typescript/session';
import { getAgentChatAvatar } from '@/utils/agent';
import styles from './index.module.less';

const { Paragraph } = Typography;

interface ConnectState {
  session: ISessionState;
  user: UserState;
}

const DialogueRecord: React.FC = () => {
  const navigate = useNavigate();
  const intl = useIntl();
  const dispatch = useDispatch();

  const globalContext = useGlobal();
  const { search, removeSearchListItem, searchList, isSearchLoading, searchKey, searchHasMore: hasMore } = useSearch();
  const isSearching = !!searchKey;

  const [dialogueList, setDialogueList] = useState<ISession[]>([]);

  const showTimes = useRef({
    today: false,
    yesterday: false,
    early: false,
  });

  const today = dayjs();
  const yesterday = today.subtract(1, 'day');

  const { delLoading } = useSelector((state: ConnectState) => state.session);

  const onRemove = (payload: { sessionId: string }) => {
    dispatch({
      type: 'session/deleteSession',
      payload,
    }).then(() => {
      if (`${payload.sessionId}` === `${globalContext.sessionId}`) {
        globalContext.setAgentId?.('');
        globalContext.setSessionId?.('');

        navigate('/chat');
        return;
      }

      if (isSearching) {
        setDialogueList(removeSearchListItem(`${payload.sessionId}`));
      }
    });
  };

  useEffect(() => {
    search();
    return () => {
      showTimes.current = {
        today: false,
        yesterday: false,
        early: false,
      };
    };
  }, []);

  useEffect(() => {
    showTimes.current = {
      today: false,
      yesterday: false,
      early: false,
    };
    setDialogueList(searchList);
  }, [searchList]);

  // 处理搜索
  const handleSearch = (value: string) => search?.(value);

  // 菜单项
  const menuItems = (item: ISession) => [
    {
      key: 'del',
      label: (
        <Popconfirm
          title={intl.formatMessage({ id: 'common.deleteTips' })}
          onConfirm={(e: any) => {
            e.preventDefault();
            e.stopPropagation();
            if (delLoading) return;
            onRemove({ sessionId: item.sessionId });
          }}
        >
          <AntdIcon type="icon-a-Deleteshanchu" style={{ marginRight: '10px' }} />
          {intl.formatMessage({ id: 'common.delete' })}
        </Popconfirm>
      ),
      danger: true,
    },
  ];

  // 对话列表项渲染
  const sessionItemRender = (item: ISession) => {
    let title;
    let isToday;
    if (!showTimes.current.today && dayjs(item.createTime).isSame(today, 'date')) {
      showTimes.current.today = true;
      title = intl.formatMessage({ id: 'dialogueRecord.today' });
      isToday = true;
    }

    if (!showTimes.current.yesterday && dayjs(item.createTime).isSame(yesterday, 'date')) {
      showTimes.current.yesterday = true;
      title = intl.formatMessage({ id: 'dialogueRecord.yesterday' });
    }

    if (!showTimes.current.early && dayjs(item.createTime).isBefore(yesterday, 'date')) {
      showTimes.current.early = true;
      title = intl.formatMessage({ id: 'dialogueRecord.earlier' });
    }

    return (
      <div
        key={item.sessionId}
        className={styles.dialogueItem}
        onClick={() => {
          globalContext.setAgentId?.('');
          globalContext.setSessionId?.(`${item.sessionId}`);
          navigate('/chat');
        }}
      >
        {title && (
          <span
            className={classnames(styles.dialogueTime, {
              [styles.notToday]: !isToday,
            })}
          >
            {title}
          </span>
        )}
        <div className={styles.dialogueInfo}>
          <div className={styles.dialogueTitle}>
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                backgroundColor: `var(--${PREFIX_NAME}-${item.theme}-2)`,
                marginRight: '10px',
              }}
            >
              {getAgentChatAvatar(item.avatar)}
            </div>
            {item.sessionName}
          </div>
          <Dropdown
            menu={{
              items: menuItems(item),
              onClick: ({ key, domEvent }) => {
                domEvent.preventDefault();
                domEvent.stopPropagation();
                if (key === 'pushpin') {
                  //
                }
              },
            }}
          >
            {/* 一定要有父节点包着AntdIcon，否则会死循环更新页面全屏报错 */}
            <span
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
              }}
            >
              <AntdIcon type="icon-a-Moregengduo" />
            </span>
          </Dropdown>
        </div>
        <Paragraph ellipsis={{ rows: 2 }}>
          {get(item, 'messageStruct') || get(item, 'messageDtoList.0.messageContent') || item.sessionName}
        </Paragraph>
      </div>
    );
  };

  return (
    <div className={styles.dialogueRecordPage}>
      <Spin spinning={isSearchLoading}>
        <div className={styles.dialogueRecordContent}>
          <div className={classnames(styles.headerSection, 'ub ub-pj ub-ac')}>
            <span className={styles.pageTitle}>{intl.formatMessage({ id: 'dialogueRecord.title' })}</span>
            <Space>
              <Input
                placeholder={intl.formatMessage(
                  {
                    id: 'common.searchPlaceholder',
                  },
                  {
                    content: intl.formatMessage({
                      id: 'dialogueRecord.title',
                    }),
                  }
                )}
                suffix={<SearchOutlined />}
                allowClear
                onPressEnter={(e) => {
                  if (isSearchLoading) return;
                  handleSearch(e.currentTarget.value);
                }}
                onClear={() => {
                  handleSearch('');
                }}
              />
            </Space>
          </div>

          <Space className={styles.filterButtons}></Space>

          <div className={styles.dialogueList}>
            <div className="full-height full-width hideThumb overflow-auto" id="scrollDialogueRecord">
              <InfiniteScroll
                hasMore={hasMore}
                next={() => {
                  handleSearch(searchKey);
                }}
                loader={
                  <div className="ub ub-ac ub-pc" style={{ height: '36px' }}>
                    <Spin />
                  </div>
                }
                endMessage={
                  <Divider plain>
                    {intl.formatMessage({ id: 'common.endMessage' })}{' '}
                    <span role="img" aria-label="emoji">
                      🤐
                    </span>
                  </Divider>
                }
                dataLength={dialogueList.length}
                scrollableTarget="scrollDialogueRecord"
                inverse={false}
                scrollThreshold="50px"
                hasChildren={dialogueList.length > 0}
                style={{ overflow: 'visible' }}
              >
                {dialogueList.map(sessionItemRender)}
              </InfiniteScroll>
            </div>
          </div>
        </div>
      </Spin>
    </div>
  );
};

export default DialogueRecord;
