// tslint:disable:ordered-imports
import React, { useCallback, useMemo } from 'react';

import { concat } from 'lodash';

import { Table } from 'antd';

import { getUnitName, getShowDimFieldList } from '@/components/MessagesComp/util';

import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';

import styles from './index.module.less';

function TableComp(props: any) {
  const { chartContent } = props;

  const { dimFieldList, measureFieldList = [], resultData = [] } = chartContent || {};
  const dataSource = resultData.map((ele: { [key: string]: any }, index) => ({ ...ele, key: index }));

  const getCommonCfg = useCallback((ele: any) => {
    return {
      title: `${ele.aliasFieldCode}${getUnitName(ele.unit, 1)}`,
      dataIndex: ele.aliasFieldCode,
      key: ele.aliasFieldCode,
      className: 'nowrap',
      render: (text: string, record: { [fieldKey: string]: string }) =>
        record[`${ele.aliasFieldCode}_formatted`] || record[ele.aliasFieldCode],
    };
  }, []);

  // todo: 后端排序
  const columns = useMemo(() => {
    const _columns: ColumnsType = concat(
      [],
      getShowDimFieldList(chartContent).map((ele) => ({
        ...getCommonCfg(ele),
        sorter: (a, b) => {
          return a[ele.aliasFieldCode]?.localeCompare(b[ele.aliasFieldCode]);
        },
      })),
      measureFieldList.map((ele) => ({
        ...getCommonCfg(ele),
        sorter: (a, b) => {
          return a[ele.aliasFieldCode] - b[ele.aliasFieldCode];
        },
      }))
    );

    return _columns;
  }, [dimFieldList, measureFieldList]);

  // 超过十条数据显示分页
  const pageSize = 10;
  const pagination: TablePaginationConfig | false = resultData.length >= pageSize && {
    pageSizeOptions: [5, 10, 15, 20, 30, 40],
    defaultPageSize: pageSize,
    showSizeChanger: true,
  };

  return (
    <Table
      scroll={{ x: true }}
      pagination={pagination}
      bordered={false}
      size="small"
      className={styles.wrapper}
      dataSource={dataSource}
      columns={columns}
    />
  );
}

export default TableComp;
