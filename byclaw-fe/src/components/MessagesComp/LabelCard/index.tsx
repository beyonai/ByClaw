// tslint:disable:ordered-imports
import React, { useCallback, useState } from 'react';
import classnames from 'classnames';
import { Pagination } from 'antd';
import COLORS from './const';
import { getUnitName } from '../util';

import styles from './index.module.less';

function LabelCardComp(props: any) {
  const { chartContent } = props;
  const {
    // componentList,
    measureFieldList,
    // dimFieldList,
    resultData,
  } = chartContent || {};

  // 这里只处理第一条数据
  const [pageIndex, setPageIndex] = useState(1);
  const data = resultData[pageIndex - 1] || {};
  const measureItems: any[] = measureFieldList;

  const measureCards = measureItems
    // .filter((ele) => data[ele.aliasFieldCode] !== undefined)
    .map((ele, index) => ({
      name: ele.aliasFieldCode,
      value: data[`${ele.aliasFieldCode}_formatted`] || data[ele.aliasFieldCode],
      unit: ele.unit,
      color: COLORS[index % COLORS.length],
    }));

  // 根据name区分icon类型
  const getMatchIcon = useCallback((name: string) => {
    if (!name) return '';
    if (name.includes('量')) {
      return 'icon-a-Chart-linezhexiantutianchong';
    }
    if (name.includes('值')) {
      return 'icon-a-Financejinrong';
    }
    if (name.includes('比') || name.includes('率')) {
      return 'icon-a-Pie-twojindu2';
    }
    return 'icon-a-Chart-linezhexiantutianchong';
  }, []);

  // 根据name排序
  const getSortIndexItem = useCallback((name: string) => {
    if (name?.includes('率')) {
      return 1;
    }
    if (name?.includes('量')) {
      return 2;
    }
    return 3;
  }, []);

  return (
    <>
      <div
        className={classnames('mW600', styles.measureRows, {
          [styles.measureRowsOne]: measureCards.length > 1,
        })}
      >
        {Boolean(measureCards.length) &&
          measureCards
            .sort((a, b) => getSortIndexItem(a.name) - getSortIndexItem(b.name))
            .map((ele) => (
              <div key={ele.name} className={`${styles.firstCard} ub`}>
                <div>
                  <div className={styles.labelName}>
                    {ele.name}
                    {getUnitName(ele?.unit, 1)}
                  </div>
                  <div className={styles.labelValue}>{ele.value}</div>
                </div>
                <span className={styles.cardIcon} style={{ backgroundColor: ele.color }}>
                  <i className={`iconfont ${getMatchIcon(ele.name)}`} />
                </span>
              </div>
            ))}
      </div>
      {resultData.length > 1 && (
        <Pagination
          pageSize={1}
          current={pageIndex}
          size="small"
          total={resultData.length}
          showQuickJumper
          simple
          style={{
            marginTop: '12px',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
          onChange={(page: number) => {
            setPageIndex(page);
          }}
        />
      )}
    </>
  );
}

export default LabelCardComp;
