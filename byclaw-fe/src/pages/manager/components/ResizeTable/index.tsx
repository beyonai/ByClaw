// @ts-nocheck
/* eslint-disable */
import React, { useEffect, useState } from 'react';
import { Pagination } from 'antd';
import _uniqueId from 'lodash/uniqueId';
import Layout from '@/pages/manager/components/ausong/Layout';
import FillTable from '@/pages/manager/components/FillTable';
import styles from './index.module.less';

function BaseViewTable(props) {
  const { className, header, left, footer, handleOnResize, direction, id, ...otherProps } = props;

  // 用来保存页面高度 - 表格滚动区域的高度，resize时直接用页面高度减去otherHeight获取新的滚动区域。
  const [otherHeight, setOtherHeight] = useState();

  const [rootId] = useState(() => _uniqueId('baseViewTable'));
  return (
    <Layout
      className={[className, 'base-view-table', otherProps?.dataSource?.length ? '' : styles.emptyTable]
        .filter(Boolean)
        .join(' ')}
      id={id || rootId}
      direction={direction}
      left={left}
      header={header}
      footer={footer}
    >
      {() => {
        return (
          <FillTable
            otherHeight={otherHeight}
            onResize={(...args) => {
              const { w, h } = args?.[0] ?? {};
              const availHeight = document.documentElement.offsetHeight;
              if (!otherHeight) {
                if (h) {
                  setOtherHeight(availHeight - h);
                } else {
                  // 浙江现场chrome版本55.0.2883.0 h 为 0 bug 处理
                  // 测试页面： 浙江能耗报表， 容量负载率统计报表
                  const elm = document.querySelector(`#${id || rootId}`);
                  if (!elm) return;
                  const { bottom } = elm.getBoundingClientRect();
                  let newOtherHeight = bottom;
                  const tableWrapper = document.querySelector(
                    `#${id || rootId} > .antd-pro-components-ausong-flex-index-flex_auto`
                  );
                  if (tableWrapper && tableWrapper.offsetHeight) {
                    newOtherHeight -= tableWrapper.offsetHeight;
                  }
                  // 91 表头 + 分页高度（大概值）
                  setOtherHeight(Math.min(availHeight - 91, newOtherHeight));
                }
              }
              handleOnResize?.(...args);
            }}
            style={{ height: '100%' }} /** 限制 table 高度 */
            pagination={false}
            {...otherProps}
          />
        );
      }}
    </Layout>
  );
}

export default BaseViewTable;
