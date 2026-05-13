// tslint:disable:ordered-imports
import React, { useCallback, useReducer, useState } from 'react';
// import { querySimilarWordFromLucene } from '@/service/chatBI';
import { getDefaultPagination, paginationReducer } from '@/utils/pageInfo';
import { CheckOutlined, CloseCircleFilled, DownOutlined, UpOutlined } from '@ant-design/icons';
import { Input, List, Popconfirm, Popover, Spin, Tag } from 'antd';
import { useIntl } from '@umijs/max';
import { concat, uniq } from 'lodash';
import InfiniteScroll from 'react-infinite-scroll-component';
import { IRecallInfo } from '../../index.d';
import styles from '../../index.less';

const LIST_HEIGHT = 300;
const PAGE_SIZE = 10;

// 渲染单个改写字段信息
const RecallItem = ({
  item,
  showLabel = true,
  showMore = false,
  showInitSearch = true,
  mergeName = true,
  className,
  handleChoose,
  handleDelete,
  knowledgeBaseId,
}: {
  item: IRecallInfo;
  showLabel?: boolean;
  showMore?: boolean;
  showInitSearch?: boolean;
  mergeName?: boolean;
  className?: string;
  handleChoose: (title: string) => void;
  handleDelete?: () => void;
  knowledgeBaseId?: string;
}) => {
  const [activeOpenKey, setActiveOpenKey] = useState<boolean>(false);
  const [listData, setListData] = useState<string[]>([]);
  const [searchValue, setSearchValue] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [scrollParent, setScrollParent] = useState<HTMLDivElement | null>(null);
  const [paginationInfo, paginationDispatch] = useReducer(
    paginationReducer,
    getDefaultPagination({ pageSize: PAGE_SIZE })
  );
  const intl = useIntl();
  const scrollableRef = useCallback((node: HTMLDivElement) => {
    if (!node) return;
    setScrollParent(node);
  }, []);

  const { name, list = [], selectedName = item.name, complete } = item || {};
  const [showSearch, setShowSearch] = useState<boolean>(list.length === 0 && showInitSearch);
  const defClassNames = `${complete ? styles.conditionItemComplete : styles.conditionItemNotComplete}`;

  // 合并所有数据源
  const dataSource = uniq(
    concat(
      // 原文
      mergeName ? name : [],
      // 原子术语
      list.map(({ mergeName }) => mergeName),
      // 搜索的相似词
      showMore && showSearch ? listData : [],
      // 更多
      showMore && !showSearch ? [intl.formatMessage({ id: 'common.more' })] : []
    )
  ).filter(Boolean);

  // 搜索相似词 是否还有更多数据
  const hasMore = (listData?.length ?? 0) < paginationInfo.total || paginationInfo.pageIndex < paginationInfo.pageCount;

  // 搜索引擎查询相似词
  const getList = useCallback(
    async (searchKeyword?: string, isLoadMore = false) => {
      const searchName = searchKeyword || searchValue;
      if (loading || !searchName || !knowledgeBaseId) return;

      setLoading(true);
      // const res = await querySimilarWordFromLucene({
      //   pageIndex,
      //   pageSize: paginationInfo.pageSize,
      //   searchName,
      //   knowledgeBaseId,
      // }).catch((err) => {
      //   message.error(intl.formatMessage({ id: 'chatBI.querySimilarWordFailed' }));
      // });
      const res: any = {};
      setLoading(false);
      // 更新相似词列表及分页信息
      paginationDispatch({
        type: 'change',
        item: {
          pageIndex: res?.pageInfo?.pageIndex || 1,
          total: res?.pageInfo?.total || 0,
        },
      });
      const list = (res?.rows || []).map((item: any) => item?.worldName);
      setListData((prev) => (isLoadMore ? [...prev, ...list] : list));
    },
    [searchValue, paginationInfo.pageIndex, paginationInfo.pageSize, loading, knowledgeBaseId]
  );

  // 加载更多数据
  const loadMoreData = useCallback(() => {
    if (!loading && hasMore) {
      getList(undefined, true);
    }
  }, [loading, hasMore, getList]);

  return (
    <span className={className || defClassNames}>
      <span>
        {showLabel && <span className={styles.tagTitle}>{`${name}`}</span>}
        {showLabel && (
          <i
            className="iconfont icon-a-Arrow-rightjiantouyou2x pointer"
            style={{ margin: '0 6px', fontSize: '12px' }}
          />
        )}
        <span className={styles.tagItem}>
          <Popover
            destroyTooltipOnHide
            arrow={false}
            trigger={['click']}
            overlayClassName={styles.popWrap}
            open={activeOpenKey}
            onOpenChange={(openFlag) => {
              if (!openFlag) {
                setActiveOpenKey(false);
              }
            }}
            content={
              <div>
                {showSearch && (
                  <Input.Search
                    autoFocus
                    placeholder={intl.formatMessage({ id: 'chatBI.inputSearchKeyword' })}
                    onSearch={(value) => {
                      getList(value, false);
                      setSearchValue(value);
                    }}
                    allowClear
                    size="small"
                    className={styles.searchInput}
                  />
                )}
                <div
                  style={{
                    maxHeight: `${LIST_HEIGHT}px`,
                  }}
                  className={styles.scrollable}
                  ref={scrollableRef}
                >
                  {
                    // 此处需要等scrollableRef元素渲染完毕，使InfiniteScroll能获取到scrollableTarget，兼听滚动事件
                    scrollParent && (
                      <InfiniteScroll
                        dataLength={listData.length}
                        next={loadMoreData}
                        hasMore={hasMore}
                        loader={
                          <div className="ub ub-ac ub-pc" style={{ height: '36px' }}>
                            <Spin />
                          </div>
                        }
                        scrollableTarget={scrollParent as any}
                        scrollThreshold="20px"
                        endMessage=""
                      >
                        <List
                          size="small"
                          bordered={false}
                          dataSource={dataSource}
                          loading={listData.length === 0 && showSearch && loading}
                          renderItem={(title: string, index: number) => (
                            <List.Item
                              title={title}
                              key={title}
                              className={`pointer ellipsis ${selectedName === title ? 'active' : ''}`}
                              onClick={(e) => {
                                // 如果当前是更多，并且是最后一项，则显示搜索，且查询相似词
                                if (
                                  showMore &&
                                  !showSearch &&
                                  index === dataSource.length - 1 &&
                                  title === intl.formatMessage({ id: 'common.more' })
                                ) {
                                  e.stopPropagation();
                                  setShowSearch(true);
                                  getList(selectedName);
                                  setSearchValue(selectedName);
                                  return;
                                }
                                setActiveOpenKey(false);
                                handleChoose(title);
                              }}
                              style={{
                                display: 'flex',
                                padding: '8px 12px',
                                cursor: 'pointer',
                                transition: 'background-color 0.2s',
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor = '#f5f5f5';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = 'transparent';
                              }}
                            >
                              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
                              {selectedName === title && (
                                <CheckOutlined
                                  style={{
                                    marginLeft: '8px',
                                    color: '#1890ff',
                                  }}
                                />
                              )}
                            </List.Item>
                          )}
                        />
                      </InfiniteScroll>
                    )
                  }
                </div>
              </div>
            }
          >
            <span
              onClick={() => {
                if (complete) return;
                // 如果showMore和showSearch都为true，且listData为空，则获取相似词
                if (showMore && showSearch && listData.length === 0) {
                  getList(selectedName);
                  setSearchValue(selectedName);
                }
                setActiveOpenKey(true);
              }}
            >
              <Tag
                className={`${activeOpenKey ? 'active' : ''} ${styles.tagWrapper}`}
                color={complete ? '#5AC159' : '#fff'}
                key={selectedName}
              >
                {selectedName}
                {handleDelete && (
                  <Popconfirm
                    title={intl.formatMessage({ id: 'common.deleteTips' })}
                    onConfirm={() => handleDelete()}
                    onCancel={(e) => e?.stopPropagation()}
                  >
                    <span className={styles.deleteIcon} onClick={(e) => e.stopPropagation()}>
                      <CloseCircleFilled />
                    </span>
                  </Popconfirm>
                )}
                {!complete &&
                  (activeOpenKey ? (
                    <UpOutlined style={{ marginLeft: '7px', fontSize: '9px' }} />
                  ) : (
                    <DownOutlined style={{ marginLeft: '7px', fontSize: '9px' }} />
                  ))}
              </Tag>
              {complete && <CheckOutlined />}
            </span>
          </Popover>
        </span>
      </span>
    </span>
  );
};

export default RecallItem;
