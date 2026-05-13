import React from 'react';

import { Checkbox, List, Radio, Spin } from 'antd';
import classNames from 'classnames';
// @ts-ignore
import { useIntl } from '@umijs/max';
import { size, isUndefined } from 'lodash';

import InfiniteScroll from '@/components/InfiniteScroll';
import styles from './index.module.less';

type InfiniteScrollTableProps = {
  columns: any[];
  dataSource: any[];
  hasMore: boolean;
  next: () => void;
  handleClick?: (item: any) => void;
  rowKey?: any;
  rowSelection?: {
    type: 'checkbox' | 'radio';
    onChange?: (selectedRowKeys: React.Key[], selectedRows: any[]) => void;
    selectedRowKeys?: React.Key[];
  };
  emptyLocale?: any;
  scrollDivId: string;
  loading?: boolean;
  loader?: React.ReactNode;
  endMessage?: React.ReactNode;
};

const InfiniteScrollTable = (props: InfiniteScrollTableProps) => {
  const {
    columns,
    dataSource,
    hasMore,
    next,
    handleClick,
    rowSelection,
    rowKey,
    emptyLocale = {},
    scrollDivId,
    loading,
    loader,
    endMessage,
  } = props;

  const intl = useIntl();
  let renderEndMessage: React.ReactNode = null;
  if (!!endMessage) {
    renderEndMessage = endMessage;
  } else if (isUndefined(endMessage)) {
    renderEndMessage = <div className="ub ub-ac ub-pc">{intl.formatMessage({ id: 'common.endMessage2' })}</div>;
  }

  return (
    <div className={classNames(styles.infiniteScrollTable)}>
      <div className={styles.tableHeader}>
        {rowSelection?.type && (
          <div className={styles.tableSelect}>
            {rowSelection?.type === 'checkbox' && (
              <Checkbox
                checked={rowSelection?.selectedRowKeys?.length === dataSource.length}
                indeterminate={
                  size(rowSelection?.selectedRowKeys) > 0 && size(rowSelection?.selectedRowKeys) < dataSource.length
                }
                onChange={(e) => {
                  rowSelection?.onChange?.(e.target.checked ? dataSource.map((item) => item[rowKey]) : [], dataSource);
                }}
              />
            )}
            {rowSelection?.type === 'radio' && (
              <Radio
                checked={rowSelection?.selectedRowKeys?.length === 1}
                onChange={(e) => {
                  rowSelection?.onChange?.(e.target.checked ? [dataSource[0][rowKey]] : [], [dataSource[0]]);
                }}
              />
            )}
          </div>
        )}
        {columns.map((item) => (
          <div key={item.dataIndex} className={styles.th} style={item?.width ? { width: item?.width } : { flex: 1 }}>
            {item.title}
          </div>
        ))}
      </div>
      <div className={styles.tableBody}>
        <div id={scrollDivId} className="full-height full-width hideThumb overflow-auto">
          <InfiniteScroll
            next={next}
            hasMore={hasMore}
            loader={
              loader || (
                <div className="ub ub-ac ub-pc" style={{ height: '36px' }}>
                  <Spin />
                </div>
              )
            }
            endMessage={dataSource.length > 0 && !hasMore && renderEndMessage}
            dataLength={dataSource.length}
            scrollableTarget={scrollDivId}
            inverse={false}
            scrollThreshold="50px"
            hasChildren={dataSource.length > 0}
            style={{ overflow: 'visible' }}
          >
            <List
              loading={loading}
              dataSource={dataSource}
              renderItem={(item) => (
                <List.Item
                  key={item}
                  onClick={() => {
                    handleClick?.(item);
                  }}
                  // className={}
                >
                  {rowSelection?.type && (
                    <div className={styles.tableSelect}>
                      {rowSelection?.type === 'checkbox' && (
                        <Checkbox
                          checked={rowSelection?.selectedRowKeys?.includes(item[rowKey])}
                          onChange={(e) => {
                            rowSelection?.onChange?.(
                              e.target.checked
                                ? [...(rowSelection?.selectedRowKeys || []), item[rowKey]]
                                : rowSelection?.selectedRowKeys?.filter((i) => i !== item[rowKey]) || [],
                              [
                                ...(rowSelection?.selectedRowKeys?.map((i) =>
                                  dataSource.find((j) => j[rowKey] === i)
                                ) || []),
                                item,
                              ]
                            );
                          }}
                        />
                      )}
                      {rowSelection?.type === 'radio' && (
                        <Radio
                          checked={rowSelection?.selectedRowKeys?.includes(item[rowKey])}
                          onChange={(e) => {
                            rowSelection?.onChange?.(e.target.checked ? [item[rowKey]] : [], [item]);
                          }}
                        />
                      )}
                    </div>
                  )}
                  {columns.map((column, index) => (
                    <div
                      className={styles.tr}
                      key={index}
                      style={column?.width ? { width: column?.width } : { flex: 1 }}
                    >
                      {column?.render ? column?.render(item[column.dataIndex], item) : item[column.dataIndex]}
                    </div>
                  ))}
                </List.Item>
              )}
              locale={emptyLocale}
            />
          </InfiniteScroll>
        </div>
      </div>
    </div>
  );
};

export default InfiniteScrollTable;
