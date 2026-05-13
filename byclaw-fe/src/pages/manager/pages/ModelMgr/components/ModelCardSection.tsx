import { Button, Empty, Space } from 'antd';
import React from 'react';
import type { IntlShape } from 'react-intl';
import CardList from '@/pages/manager/components/CardList';
import styles from '../index.module.less';

type Props = {
  intl: IntlShape;
  list: any[];
  isLoading: boolean;
  actionLoading: boolean;
  activeFilterCount: number;
  pagination: any;
  onAdd: () => void;
  onReset: () => void;
  onPageChange: (pagination: { pageIndex: number; pageSize: number }) => void;
  cardItemFn: (record: any) => React.ReactNode;
};

const ModelCardSection: React.FC<Props> = ({
  intl,
  list,
  isLoading,
  actionLoading,
  activeFilterCount,
  pagination,
  onAdd,
  onReset,
  onPageChange,
  cardItemFn,
}) => {
  return (
    <div className={styles.cardList} style={{ minHeight: 0 }}>
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
          showPagination
          onPageChange={onPageChange}
          cardItemFn={cardItemFn}
        />
      )}
    </div>
  );
};

export default ModelCardSection;
