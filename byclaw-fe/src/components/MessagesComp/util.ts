/* eslint-disable indent */
import { getLocale, getIntl } from '@umijs/max';
import { get, isNil } from 'lodash';

export function formatDimension(value: string) {
  if (!value) return '';
  const keepLength = getLocale() === 'en-US' ? 20 : 10;
  return value.length > keepLength ? `${value.slice(0, keepLength)}...` : value;
}

function getValueBySimplify(value: number | string, type: 'en' | 'zh') {
  const intl = getIntl();
  const num = Number(value);
  if (isNaN(num) || !type) return { unit: '', num: value };
  // 带有小数点
  if (type === 'zh') {
    const billionValue = 10 ** 8;
    if (num >= billionValue || num <= -billionValue) {
      return {
        unit: intl.formatMessage({ id: 'messagesComp.unit.billion' }),
        num: num / billionValue,
      };
    }
    const millionValue = 10 ** 4;
    if (num >= millionValue) {
      return {
        unit: intl.formatMessage({ id: 'messagesComp.unit.tenThousand' }),
        num: num / millionValue,
      };
    }

    if (num < 0 && num <= -millionValue) {
      return {
        unit: intl.formatMessage({ id: 'messagesComp.unit.tenThousand' }),
        num: num / millionValue,
      };
    }

    return {
      unit: '',
      num,
    };
  }

  const billionEnValue = 10 ** 9;
  if (num >= billionEnValue || num <= -billionEnValue) {
    return {
      num: num / billionEnValue,
      unit: 'B',
    };
  }

  const millionEnValue = 10 ** 6;
  if (num >= millionEnValue || num <= -millionEnValue) {
    return {
      num: num / millionEnValue,
      unit: 'M',
    };
  }

  const thEnValue = 10 ** 3;
  if (num >= thEnValue || num <= -thEnValue) {
    return {
      num: num / thEnValue,
      unit: 'K',
    };
  }

  return {
    num,
    unit: '',
  };
}

export function formatMeasure(value: number | string) {
  if (isNil(value)) return '';
  // 带有小数点
  const { num, unit } = getValueBySimplify(value, 'zh');
  if (isNil(num)) return '';
  return `${num.toLocaleString('en')}${unit}`;
}

export function getUnitName(unit?: string, styleType?: number) {
  if (isNil(unit)) return '';

  let str = '';
  switch (styleType) {
    case 1:
      str = unit ? `(${unit})` : ''; // （unit）
      break;
    default:
      str = unit || ''; // unit
      break;
  }
  return str;
}

export function getYAxisItem(measureItem: any, yAxis: any) {
  return {
    name: `${measureItem?.aliasFieldCode}${getUnitName(measureItem.unit, 1)}`,
    type: 'value',
    ...yAxis,
    nameTextStyle: { ...get(yAxis, 'nameTextStyle'), align: 'left' },
    axisLabel: {
      formatter: (value: number) => {
        return formatMeasure(value);
      },
    },
  };
}

export function getTooltips(measureItems?: any[]) {
  return {
    trigger: 'axis',
    axisPointer: {
      type: 'cross',
    },
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    appendToBody: true,
    formatter: (params: any) => {
      return `<div style="margin: 0px 0 0;line-height:1;">
        <div style="margin: 0px 0 0;line-height:1;">
        <div style="font-size:14px;color:#666;font-weight:400;line-height:1;">${get(params, '0.name', '')}</div>
          ${params
            .map(
              (ele: any, index: number) =>
                `<div style="margin: 10px 0 0;line-height:1;">
              ${ele.marker}
              <span style="font-size:14px;color:#666;font-weight:400;margin-left:2px">${ele.seriesName}</span>
              <span style="float:right;margin-left:20px;font-size:14px;color:#666;font-weight:900">${
                formatMeasure(ele.value) + getUnitName(measureItems && measureItems[index], 2)
              }</span>
            </div>`
            )
            .join('')}
        </div>
      </div>`;
    },
  };
}

/**
 * 从fieldListType的字段分组中拿到第一个字段，获取第一个字段的resultData值列表
 * @param analysisData
 * @param fieldListType
 * @returns
 */
export function getFieldRow(analysisData?: any, fieldListType?: 'dimFieldList' | 'measureFieldList') {
  if (!analysisData) return [];

  const fieldList = get(analysisData, `${fieldListType}`, []).filter((ele) => !ele.isHidden);
  const resultData = get(analysisData, 'resultData', []);

  return fieldList.map((field: any) => {
    const { aliasFieldCode } = field;

    return {
      ...field,
      data: resultData.map((ele: any) => ele[aliasFieldCode]),
    };
  });
}

export function getShowDimFieldList(analysisData: any) {
  const dimFieldList = get(analysisData, 'dimFieldList', []);
  return dimFieldList.filter((ele) => !ele.isHidden);
}

export function getLegend(analysisData?: any) {
  if (!analysisData) return undefined;

  const dimFieldList = getShowDimFieldList(analysisData);

  const colorFieldKey = get(dimFieldList, '1.aliasFieldCode', '');

  const measureFieldList = get(analysisData, 'measureFieldList', []);
  let legend;

  if (colorFieldKey) {
    const colorFieldVals = [...new Set(getFieldRow(analysisData, 'dimFieldList')?.[1]?.data)];
    legend = {
      data: colorFieldVals.map((val: string) => `${val}`),
    };
  }

  // 优先把多个度量字段作为图例字段
  if (measureFieldList.length > 1) {
    legend = {
      data: measureFieldList.map(({ aliasFieldCode }: { aliasFieldCode: string }) => aliasFieldCode),
    };
  }

  if (legend) {
    legend = {
      ...legend,
      type: 'scroll',
      orient: 'horizontal',
      top: 'bottom',
    };
  }

  return legend;
}

/**
 * 从fieldListType的字段分组中拿到第二个字段，作为tooltips name
 * @param analysisData
 * @returns
 */
export function getSeriesRow(analysisData?: any) {
  if (!analysisData) return [];

  const resultData = get(analysisData, 'resultData', []);

  const dimFieldList = getShowDimFieldList(analysisData);

  const xAxisFieldKey = get(dimFieldList, '0.aliasFieldCode', '');
  const colorFieldKey = get(dimFieldList, '1.aliasFieldCode', '');
  const measureList = get(analysisData, 'measureFieldList', []);

  // 多度量字段作为图例
  if (!colorFieldKey || measureList.length > 1) {
    const leftUnit = get(measureList, '0.unit');
    return measureList.map((item: any) => {
      const { aliasFieldCode } = item;
      return {
        ...item,
        name: aliasFieldCode,
        data: resultData.map((ele) => ele[aliasFieldCode]),
        type: item.unit === leftUnit ? 'left' : 'right',
        yAxisIndex: item.unit === leftUnit ? undefined : 1,
      };
    });
  }

  const measureFieldKey = measureList?.[0]?.aliasFieldCode;

  const xAxisNames = [...new Set(resultData.map((ele) => ele[xAxisFieldKey]))];
  const seriesNames = [...new Set(resultData.map((ele) => ele[colorFieldKey]))];
  const series: { data: any; name: string | number }[] = [];

  seriesNames.forEach((element) => {
    series.push({
      name: element,
      data: xAxisNames.map((ele) => {
        const dataItem = resultData
          .filter((data) => data[xAxisFieldKey] === ele)
          .find((data) => data[colorFieldKey] === element);

        return dataItem && dataItem[measureFieldKey];
      }),
    });
  });

  return series;
}
