import React, { useEffect } from 'react';
import AntdIcon from '@/components/AntdIcon';
import { Spin, List } from 'antd';
import InfiniteScroll from '@/components/InfiniteScroll';
import classnames from 'classnames';
import styles from './index.module.less';
import commonStyles from '@/layout/sider/components/common-list.module.less';
// @ts-ignore
import { useDispatch, useSelector, useIntl } from '@umijs/max';
import { size } from 'lodash';

const UnreadNoticeList = () => {
  const intl = useIntl();
  const dispatch = useDispatch();

  const { loading } = useSelector(({ loading }) => ({
    loading: loading.effects['notice/getAllNotice'],
  }));
  const { unreadNoticeList, unreadNoticePagination } = useSelector(({ notice }) => ({
    unreadNoticeList: notice.unreadNoticeList || [],
    unreadNoticePagination: notice.unreadNoticePagination || {},
  }));
  const { total, pageIndex } = unreadNoticePagination;

  const hasMore = React.useMemo(() => {
    return size(unreadNoticeList) < total;
  }, [unreadNoticeList, total]);

  const loadNotices = (pageNum: number, opts?: { isRead?: '0' | '1' }) => {
    dispatch({ type: 'notice/getAllNotice', payload: { pageNum, isRead: opts?.isRead } });
  };

  const handleReadNotice = (item: any) => {
    // 已读则不处理
    if (item.isRead === '1') {
      return;
    }
    dispatch({ type: 'notice/batchReadNotice', payload: { idList: [item.id] } });
  };

  useEffect(() => {
    loadNotices(1, { isRead: '0' });
  }, []);

  return (
    <Spin spinning={loading} wrapperClassName={styles.spin}>
      <div className={classnames('full-width full-height')}>
        <InfiniteScroll
          className="hideThumb"
          next={() => {
            loadNotices(pageIndex ? pageIndex + 1 : 1, { isRead: '0' });
          }}
          hasMore={hasMore}
          dataLength={unreadNoticeList.length}
          hasChildren={unreadNoticeList.length > 0}
          loader={
            <div className={commonStyles.listLoader}>
              <Spin size="small" />
            </div>
          }
          scrollableTarget="unReadNoticeListWrap"
          inverse={false}
          scrollThreshold="50px"
          height={560}
        >
          <List
            className={styles.noticeListBlock}
            dataSource={unreadNoticeList}
            split={false}
            renderItem={(item: any) => {
              return (
                <List.Item className={classnames('pointer')} onClick={() => handleReadNotice(item)}>
                  <div className={classnames('ub gap8 ub-ac')}>
                    <span className={classnames(styles.titleIcon, 'ub ub-ac ub-pc')}>
                      <AntdIcon type="icon-tongzhi-fill" className={styles.noticeIcon} />
                    </span>
                    <span className={classnames('bold')}>{intl.formatMessage({ id: 'notice.title' })}</span>
                    <span>{item.createTime}</span>
                    {item.isRead === '0' && <span className={styles.unReadTag} />}
                  </div>
                  <div className={classnames('mt-8')}>{item.content}</div>
                </List.Item>
              );
            }}
          />
        </InfiniteScroll>
      </div>
    </Spin>
  );
};

export default UnreadNoticeList;
