import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Empty, List, Spin, message } from 'antd';
import classNames from 'classnames';
import { isEmpty } from 'lodash';
import { querySystemNotificationPage } from '@/pages/manager/service/NotificationMgr';
import Markdown from '@/components/Markdown';
import useGlobal from '@/hooks/useGlobal';

import useAppStore from '@/models/common/useAppStore';

import VersionComp from './VersionComp';
import NotificationComp from './NotificationComp';

import type { IVersionNotification } from '@/typescript/version';

import styles from './index.module.less';

export interface INotificationItem {
  id: string | number;
  title: string;
  content: string;
  priority?: string | number;
  createTime: string;
  bizType?: number;
}

interface IPageData {
  records?: INotificationItem[];
  list?: INotificationItem[];
  total?: number;
  current?: number;
  pageNum?: number;
  pages?: number;
  totalPages?: number;
}

const PAGE_SIZE = 10;

function normalizePageData(res: any): IPageData {
  return res?.data || res || {};
}

function normalizeRows(pageData: IPageData): INotificationItem[] {
  if (Array.isArray(pageData?.records)) {
    return pageData.records;
  }
  if (Array.isArray(pageData?.list)) {
    return pageData.list;
  }
  return [];
}

function calcHasMore(pageData: IPageData, current: number, loadedCount: number, latestCount: number) {
  const totalPages = Number(pageData?.pages ?? pageData?.totalPages);
  if (Number.isFinite(totalPages) && totalPages > 0) {
    return current < totalPages;
  }

  const total = Number(pageData?.total);
  if (Number.isFinite(total) && total >= 0) {
    return loadedCount < total;
  }

  return latestCount >= PAGE_SIZE;
}

export const NotificationContentComp = (props: { content: string }) => {
  const { content } = props;
  return (
    <>
      <div className="full-width full-height overflow-auto" style={{ padding: 12 }}>
        <Markdown text={content} />
      </div>
    </>
  );
};

export default function SystemNotification() {
  const [messageApi, contextHolder] = message.useMessage();
  const scrollWrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<INotificationItem[]>([]);
  const pageNumRef = useRef(0);
  const loadingRef = useRef(false);
  const requestSeqRef = useRef(0);

  const [list, setList] = useState<INotificationItem[]>([]);
  const [pageNum, setPageNum] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [inited, setInited] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [scrolled, setScrolled] = useState(false);

  const { EventEmitter } = useGlobal();
  const { getVersionNotification, versionNotification } = useAppStore();

  const fetchPage = useCallback(
    async (nextPageNum: number, replace = false) => {
      if (loadingRef.current) {
        return;
      }

      const requestSeq = requestSeqRef.current + 1;
      requestSeqRef.current = requestSeq;
      loadingRef.current = true;
      if (replace) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }

      try {
        const res: any = await querySystemNotificationPage({
          pageNum: nextPageNum,
          pageSize: PAGE_SIZE,
        });

        if (requestSeq !== requestSeqRef.current) {
          return;
        }

        if (res?.code !== undefined && res.code !== 0) {
          messageApi.error(res?.msg || '系统通知查询失败');
          return;
        }

        const pageData = normalizePageData(res);
        const rows = normalizeRows(pageData);
        const current = Number(pageData?.current ?? pageData?.pageNum ?? nextPageNum) || nextPageNum;
        const nextList = replace ? rows : [...listRef.current, ...rows];

        listRef.current = nextList;
        pageNumRef.current = current;
        setList(nextList);
        setPageNum(current);
        setHasMore(calcHasMore(pageData, current, nextList.length, rows.length));
      } catch (error) {
        console.error('获取系统通知失败:', error);
        messageApi.error('系统通知查询失败');
      } finally {
        if (requestSeq === requestSeqRef.current) {
          loadingRef.current = false;
          setLoading(false);
          setLoadingMore(false);
          setInited(true);
        }
      }
    },
    [messageApi]
  );

  const getDetail = useCallback(async (info: INotificationItem | IVersionNotification) => {
    EventEmitter.emit('beyond-main-driver-open-type', {
      drawerType: <NotificationContentComp {...info} />,
      canClose: true,
      title: info.title,
    });
  }, []);

  useEffect(() => {
    getVersionNotification();
  }, [getVersionNotification]);

  useEffect(() => {
    fetchPage(1, true);

    return () => {
      requestSeqRef.current += 1;
    };
  }, [fetchPage]);

  useEffect(() => {
    const el = scrollWrapRef.current;
    if (!el) {
      return;
    }

    const onScroll = () => {
      setScrolled(el.scrollTop > 4);
      const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (distanceToBottom <= 56 && hasMore && !loadingRef.current) {
        fetchPage(pageNumRef.current + 1);
      }
    };

    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [fetchPage, hasMore, pageNum]);

  if (!inited && loading && !versionNotification) {
    return (
      <div className={styles.systemNotification}>
        <div className={styles.loadingRow}>
          <Spin size="small" />
        </div>
        {contextHolder}
      </div>
    );
  }

  if (inited && isEmpty(list) && !versionNotification) {
    return (
      <div className={styles.systemNotification}>
        <div className={styles.emptyWrap}>
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={null} />
        </div>
        {contextHolder}
      </div>
    );
  }

  return (
    <div className={styles.systemNotification}>
      {versionNotification && (
        <div style={{ padding: '0 8px' }} className="pointer" onClick={() => getDetail(versionNotification)}>
          <VersionComp item={versionNotification as IVersionNotification} />
        </div>
      )}
      <div ref={scrollWrapRef} className={classNames(styles.scrollWrap, { [styles.scrolled]: scrolled })}>
        <List
          split={false}
          dataSource={list}
          className={styles.list}
          renderItem={(item) => {
            return (
              <List.Item
                className={classNames(styles.noticeItem)}
                key={item.id || `${item.title}-${item.createTime}`}
                onClick={() => getDetail(item)}
              >
                <NotificationComp item={item as INotificationItem} />
              </List.Item>
            );
          }}
        />
        {loadingMore ? (
          <div className={styles.endRow}>
            <Spin size="small" />
          </div>
        ) : null}
        {!hasMore && list.length > 0 ? <div className={styles.endRow}>没有更多了</div> : null}
      </div>
      {contextHolder}
    </div>
  );
}
