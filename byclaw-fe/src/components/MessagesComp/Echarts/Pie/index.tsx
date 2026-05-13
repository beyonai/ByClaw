// tslint:disable:ordered-imports
import React, { useMemo } from 'react';
import ReactEcharts from 'echarts-for-react';
import { get } from 'lodash';

import { defaultOption } from './util';
import { formatMeasure, getUnitName, getShowDimFieldList } from '@/components/MessagesComp/util';

import useEcharts from '@/hooks/useEcharts';

export default function PieComp(props: any) {
  const { chartContent } = props;
  const { echatsRef } = useEcharts();

  const { series, ...rest } = useMemo(() => defaultOption, []);

  const getOption = () => {
    const measureItem = get(chartContent, 'measureFieldList.0');

    const dimFieldList = getShowDimFieldList(chartContent);
    const measureFieldList = get(chartContent, 'measureFieldList', []);

    return {
      dataset: {
        // 用 dimensions 指定了维度的顺序。直角坐标系中，如果 X 轴 type 为 category，
        // 默认把第一个维度映射到 X 轴上，后面维度映射到 Y 轴上。
        // 如果不指定 dimensions，也可以通过指定 series.encode
        // 完成映射，参见后文。
        dimensions: [get(dimFieldList, '0'), get(measureFieldList, '0')].map(
          ({ aliasFieldCode } = {}) => aliasFieldCode
        ),
        source: get(chartContent, 'resultData', []),
      },
      series: {
        name: measureItem?.aliasFieldCode,
        type: 'pie',
        ...series,
        label: {
          // formatter: (param) => param.name,
          formatter: '{b}: ({d}%)',
          overflow: 'break',
        },
        labelLayout: { hideOverlap: true },
        radius: [0, '65%'],
      },
      ...rest,
      tooltip: {
        valueFormatter: (value: number | string) => formatMeasure(value) + getUnitName(measureItem?.unit),
      },
    };
  };

  return <ReactEcharts className="mW600" option={getOption()} ref={echatsRef} />;
}
