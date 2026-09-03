import React from 'react';

import { Checkbox, List, Radio, Spin } from 'antd';
import VirtualList from 'rc-virtual-list';
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
    getCheckboxProps?: (record: any) => { disabled?: boolean };
  };
  emptyLocale?: any;
  scrollDivId: string;
  loading?: boolean;
  loader?: React.ReactNode;
  endMessage?: React.ReactNode;

  /** 仅渲染可视区域行，适用于数据量较大的文件列表。 */
  virtual?: boolean;
};

const getColumnStyle = (width?: number | string): React.CSSProperties => {
  if (width) {
    return {
      width,
      flex: `0 0 ${typeof width === 'number' ? `${width}px` : width}`,
    };
  }
  return {
    flex: '1 1 0',
    minWidth: 0,
  };
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
    virtual = false,
  } = props;

  const bodyRef = React.useRef<HTMLDivElement>(null);
  const [virtualHeight, setVirtualHeight] = React.useState(400);

  React.useEffect(() => {
    if (!virtual || !bodyRef.current) return undefined;
    const updateHeight = () => setVirtualHeight(Math.max(bodyRef.current?.clientHeight || 400, 1));
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(bodyRef.current);
    return () => observer.disconnect();
  }, [virtual]);

  const intl = useIntl();
  let renderEndMessage: React.ReactNode = null;
  if (!!endMessage) {
    renderEndMessage = endMessage;
  } else if (isUndefined(endMessage)) {
    renderEndMessage = <div className="ub ub-ac ub-pc">{intl.formatMessage({ id: 'common.endMessage2' })}</div>;
  }

  const getItemKey = (item: any) => {
    if (!item) return undefined;
    return typeof rowKey === 'function' ? rowKey(item) : item?.[rowKey];
  };
  const selectableDataSource = rowSelection?.getCheckboxProps
    ? dataSource.filter((item) => !rowSelection.getCheckboxProps?.(item)?.disabled)
    : dataSource;
  const selectableRowKeys = selectableDataSource.map(getItemKey);
  const selectedSelectableRowKeys = (rowSelection?.selectedRowKeys || []).filter((key) =>
    selectableRowKeys.includes(key)
  );
  return (
    <div className={classNames(styles.infiniteScrollTable)}>
      <div className={styles.tableHeader}>
        {rowSelection?.type && (
          <div className={styles.tableSelect}>
            {rowSelection?.type === 'checkbox' && (
              <Checkbox
                checked={selectableRowKeys.length > 0 && selectedSelectableRowKeys.length === selectableRowKeys.length}
                indeterminate={
                  size(selectedSelectableRowKeys) > 0 && size(selectedSelectableRowKeys) < selectableRowKeys.length
                }
                disabled={selectableRowKeys.length === 0}
                onChange={(e) => {
                  rowSelection?.onChange?.(
                    e.target.checked ? selectableRowKeys : [],
                    e.target.checked ? selectableDataSource : []
                  );
                }}
              />
            )}
            {rowSelection?.type === 'radio' && (
              <Radio
                checked={rowSelection?.selectedRowKeys?.length === 1}
                onChange={(e) => {
                  rowSelection?.onChange?.(e.target.checked ? [getItemKey(dataSource[0])] : [], [dataSource[0]]);
                }}
              />
            )}
          </div>
        )}
        {columns.map((item) => (
          <div key={item.dataIndex} className={styles.th} style={getColumnStyle(item?.width)}>
            {item.title}
          </div>
        ))}
      </div>
      <div className={styles.tableBody}>
        <div
          ref={bodyRef}
          id={scrollDivId}
          className="full-height full-width hideThumb overflow-auto"
          style={virtual ? { overflow: 'hidden' } : undefined}
        >
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
            {virtual ? (
              loading ? (
                <div className="ub ub-ac ub-pc" style={{ height: '100%' }}>
                  <Spin />
                </div>
              ) : dataSource.length === 0 ? (
                emptyLocale.emptyText || null
              ) : (
                <VirtualList data={dataSource} height={virtualHeight} itemHeight={56} itemKey={getItemKey}>
                  {(item) => (
                    <List.Item key={getItemKey(item)} className={styles.virtualRow} onClick={() => handleClick?.(item)}>
                      {columns.map((column, index) => (
                        <div className={styles.tr} key={index} style={getColumnStyle(column?.width)}>
                          {column?.render ? column?.render(item[column.dataIndex], item) : item[column.dataIndex]}
                        </div>
                      ))}
                    </List.Item>
                  )}
                </VirtualList>
              )
            ) : (
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
                            checked={rowSelection?.selectedRowKeys?.includes(getItemKey(item))}
                            disabled={rowSelection.getCheckboxProps?.(item)?.disabled}
                            onChange={(e) => {
                              const itemKey = getItemKey(item);
                              const nextSelectedRowKeys = e.target.checked
                                ? [...(rowSelection?.selectedRowKeys || []), itemKey]
                                : rowSelection?.selectedRowKeys?.filter((i) => i !== itemKey) || [];
                              rowSelection?.onChange?.(
                                nextSelectedRowKeys,
                                dataSource.filter((row) => nextSelectedRowKeys.includes(getItemKey(row)))
                              );
                            }}
                          />
                        )}
                        {rowSelection?.type === 'radio' && (
                          <Radio
                            checked={rowSelection?.selectedRowKeys?.includes(getItemKey(item))}
                            onChange={(e) => {
                              rowSelection?.onChange?.(e.target.checked ? [getItemKey(item)] : [], [item]);
                            }}
                          />
                        )}
                      </div>
                    )}
                    {columns.map((column, index) => (
                      <div className={styles.tr} key={index} style={getColumnStyle(column?.width)}>
                        {column?.render ? column?.render(item[column.dataIndex], item) : item[column.dataIndex]}
                      </div>
                    ))}
                  </List.Item>
                )}
                locale={emptyLocale}
              />
            )}
          </InfiniteScroll>
        </div>
      </div>
    </div>
  );
};

export default InfiniteScrollTable;
