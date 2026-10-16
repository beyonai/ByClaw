import { Button, Empty, Space } from 'antd';
import React from 'react';
import CardList from '@/pages/manager/components/CardList';
import styles from '../index.module.less';

type IntlShape = {
  formatMessage: (descriptor: { id: string }, values?: Record<string, any>) => string;
};

type Props = {
  intl: IntlShape;
  scrollRef: React.Ref<HTMLDivElement>;
  onScroll: React.UIEventHandler<HTMLDivElement>;
  list: any[];
  isLoading: boolean;
  actionLoading: boolean;
  activeFilterCount: number;
  pagination: any;
  onAdd: () => void;
  onReset: () => void;
  cardItemFn: (record: any) => React.ReactNode;
};

const ModelCardSection: React.FC<Props> = ({
  intl,
  scrollRef,
  onScroll,
  list,
  isLoading,
  actionLoading,
  activeFilterCount,
  pagination,
  onAdd,
  onReset,
  cardItemFn,
}) => {
  // 由列表区域统一承接滚动和触底加载，CardList 自身保持内容高度，避免嵌套滚动。
  return (
    <div className={styles.cardList} ref={scrollRef} onScroll={onScroll}>
      {!list.length && !isLoading && !actionLoading ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyBadge}>AI</div>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <div className={styles.emptyBody}>
                <div className={styles.emptyTitle}>{intl.formatMessage({ id: 'modelMgr.emptyTitle' })}</div>
                <div className={styles.emptyDesc}>{intl.formatMessage({ id: 'modelMgr.emptyDesc' })}</div>
              </div>
            }
          >
            <Space>
              <Button type="primary" onClick={onAdd}>
                {intl.formatMessage({ id: 'modelMgr.addNew' })}
              </Button>
              {activeFilterCount ? (
                <Button onClick={onReset}>{intl.formatMessage({ id: 'common.reset' })}</Button>
              ) : null}
            </Space>
          </Empty>
        </div>
      ) : (
        <CardList
          rowId="id"
          autoPageSize={false}
          cardWidth={300}
          canSelect={false}
          dataSource={list}
          pagination={pagination}
          loading={!!isLoading || !!actionLoading}
          showPagination={false}
          contentScrollable={false}
          cardItemFn={cardItemFn}
        />
      )}
    </div>
  );
};

export default ModelCardSection;
