// tslint:disable:ordered-imports
import React, { useMemo } from 'react';
import ReactEcharts from 'echarts-for-react';
import { get } from 'lodash';

import {
  formatDimension,
  formatMeasure,
  getFieldRow,
  getLegend,
  getSeriesRow,
  getTooltips,
  getYAxisItem,
} from '@/components/MessagesComp/util';
import { defaultOption } from './util';

import useEcharts from '@/hooks/useEcharts';

export default function LineComp(props: any) {
  const { chartContent } = props;
  const { echatsRef } = useEcharts();

  const { xAxis, yAxis, series, tooltip, ...rest } = useMemo(() => defaultOption, []);

  const getOption = () => {
    const source = get(chartContent, 'resultData', []);

    const dimData = getFieldRow(chartContent, 'dimFieldList')?.[0]?.data || [];
    const measureItems = get(chartContent, 'measureFieldList', []);
    const measureItem = get(measureItems, '0');

    const legend = getLegend(chartContent);
    const seriesData = getSeriesRow(chartContent);
    const rightYAxisItem = seriesData.find((ele: { type: string }) => ele?.type === 'right');
    if (legend && rightYAxisItem) {
      legend.data = seriesData.sort((a: { type: string }, b: { type: string }) => a?.type?.length - b?.type?.length).map((ele: any) => ele.name);
    }

    const showDaraZoom = source.length >= 100;

    return {
      legend,
      xAxis: {
        type: 'category',
        axisTick: {
          show: false,
        },
        data: [...new Set(dimData)],
        ...xAxis,
        axisLabel: {
          interval: dimData.length > 15 ? 'auto' : 0,
          rotate: dimData.length <= 15 && dimData.length >= 6 ? 45 : 0,
          formatter: (value: string) => formatDimension(value),
          ...(xAxis && xAxis.axisLabel),
        },
      },
      yAxis: [
        {
          splitNumber: 2,
          // 左右刻度线对齐
          alignTicks: true,
          ...getYAxisItem(measureItem, yAxis),
        },
      ],
      series: seriesData.map((row: any) => ({
        ...row,
        // areaStyle: {
        //   color: {
        //     ...get(res, `color.${index % res?.color?.length}`, {}),
        //     x: 0,
        //     y: 0,
        //     x2: 0,
        //     y2: 1,
        //     colorStops: [...get(res, `color.${index % res?.color?.length}.areaStops`, '')],
        //   }
        // },
        ...series,
        type: row.type === 'right' ? 'bar' : 'line',
      })),
      grid: {
        left: 8,
        bottom: 10 + (legend ? 30 : 0) + (showDaraZoom ? 50 : 0),
        top: 30,
        right: 10,
        containLabel: true,
      },
      label: {
        show: true,
        position: 'top',
        formatter: ({ value }: any) => {
          return formatMeasure(value);
        },
      },
      labelLayout: { hideOverlap: true },
      dataZoom: showDaraZoom && [
        {
          type: 'slider', // 放大缩小x轴数值
          left: 0,
          bottom: 40,
          width: '99%',
          borderColor: 'rgba(0,0,0,0)',
          fillerColor: 'rgba(0,0,0,0)',
        },
        // {
        //   type: 'inside', // 放大和缩小
        //   orient: 'vertical', // x轴
        // },
        // {
        //   type: 'inside', // 放大和缩小
        // }
      ],
      tooltip: {
        ...getTooltips(),
        ...tooltip,
      },
      ...rest,
    };
  };

  return <ReactEcharts className="mW600" option={getOption()} ref={echatsRef} />;
}
