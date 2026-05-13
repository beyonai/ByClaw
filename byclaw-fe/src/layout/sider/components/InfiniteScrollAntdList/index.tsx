import React, { useRef } from 'react';
import { List, Spin } from 'antd';
import InfiniteScroll from 'react-infinite-scroll-component';
import commonStyles from '../common-list.module.less';

interface Props<T = any> {
  dataSource: T[];
  hasMore: boolean;
  loading: boolean;
  next: () => any;
  renderItem?: (item: T, index: number) => React.ReactNode;
  renderEmpty?: React.ReactNode;
}

function ListHolder({
  id,
  loading,
  children,
  containerRef,
}: {
  id: string;
  loading: boolean;
  containerRef?: React.RefObject<HTMLDivElement | null>;
  children: React.ReactElement;
}) {
  return (
    <Spin spinning={loading} wrapperClassName={commonStyles.listSpinner}>
      <div id={id} ref={containerRef} style={{ height: '100%', overflow: 'auto' }} className="hideThumb">
        {children}
      </div>
    </Spin>
  );
}

function InfiniteScrollAntdList<T = any>(props: Props<T>) {
  const { next, dataSource, hasMore, loading, renderItem, renderEmpty } = props;
  const scrollableTarget = useRef(`scroll-target-${Math.random().toString(16).slice(2)}`);

  return (
    <ListHolder loading={loading} id={scrollableTarget.current}>
      <InfiniteScroll
        dataLength={dataSource.length}
        next={next}
        hasMore={hasMore}
        loader={
          <div className={commonStyles.listLoader}>
            <Spin size="small" />
          </div>
        }
        scrollableTarget={scrollableTarget.current}
        style={{ overflow: 'visible' }}
      >
        <List
          split={false}
          dataSource={dataSource}
          className={commonStyles.list}
          renderItem={renderItem}
          locale={{
            emptyText: renderEmpty,
          }}
        />
      </InfiniteScroll>
    </ListHolder>
  );
}

export default InfiniteScrollAntdList;
