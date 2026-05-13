// @ts-nocheck
import React, { Children } from 'react';
import { Tooltip } from 'antd';
import { getToken, getssoToken } from '@/pages/manager/utils/auth';
import { chain } from 'lodash';
import Ellipsis from '@/pages/manager/components/Ellipsis';

const defaultValueFormatter = (values: any[]) => values.join(',');

export function getFilterParams(keyMapOrKeys: any, filter: any, rawValuesFormater?: any) {
  const isKeys = Array.isArray(keyMapOrKeys);
  let valuesFormatter = rawValuesFormater || defaultValueFormatter;
  if (typeof valuesFormatter === 'function') {
    return (isKeys ? keyMapOrKeys : Object.keys(keyMapOrKeys)).reduce((params: any, key: string) => {
      if (filter[key] && filter[key].length > 0) {
        params[isKeys ? key : keyMapOrKeys[key]] = valuesFormatter(filter[key], key, params);
      }
      return params;
    }, {});
  } else {
    return (isKeys ? keyMapOrKeys : Object.keys(keyMapOrKeys)).reduce((params: any, key: string) => {
      if (filter[key] && filter[key].length > 0) {
        params[isKeys ? key : keyMapOrKeys[key]] = (
          valuesFormatter[key] ||
          valuesFormatter.defaultValueFormatter ||
          defaultValueFormatter
        )(filter[key], key, params);
      }
      return params;
    }, {});
  }
}

export const getIframeUrl = (url: string) => {
  const res = chain(url || '')
    .replace('{beyond-token}', getToken())
    .replace('{sso-token}', getssoToken())
    .value();
  return res;
};

export const getValidValue = (value: any) => {
  if (value && value !== 'null' && value !== 'undefined') {
    return value;
  }
  return '';
};

export const arrayToTree = (
  items: any[],
  { key = 'orgId', parentKey = 'parentOrgId', childrenKey = 'children', sortKey = '' }: any = {}
) => {
  const itemMap = new Map();
  const originalItemMap = new Map();
  const result: any[] = [];
  const myItems = items || [];

  if (!Array.isArray(myItems)) {
    return [];
  }

  myItems.forEach((item: any) => {
    originalItemMap.set(item[key], item);
    itemMap.set(item[key], {
      ...item,
      [childrenKey]: [],
    });
  });

  myItems.forEach((item: any) => {
    const node = itemMap.get(item[key]);
    if (!node) return;

    if (item[parentKey] === -1 || item[parentKey] === null || item[parentKey] === undefined) {
      result.push(node);
      return;
    }

    if (item[parentKey] === item[key]) {
      result.push(node);
      return;
    }

    let ancestorId = item[parentKey];
    const ancestorSet = new Set([item[key]]);
    let hasCycle = false;

    while (ancestorId !== null && ancestorId !== undefined && ancestorId !== -1) {
      if (ancestorSet.has(ancestorId)) {
        hasCycle = true;
        break;
      }
      ancestorSet.add(ancestorId);
      const ancestor = originalItemMap.get(ancestorId);
      if (!ancestor) break;
      ancestorId = ancestor[parentKey];
    }

    if (hasCycle) {
      result.push(node);
      return;
    }

    const parentNode = itemMap.get(item[parentKey]);
    if (parentNode) {
      if (!parentNode[childrenKey]) parentNode[childrenKey] = [];
      parentNode[childrenKey].push(node);
    } else {
      result.push(node);
    }
  });

  if (sortKey) {
    const sortFn = (a: any, b: any) => a[sortKey] - b[sortKey];
    const sortTree = (nodes: any[]) => {
      nodes.sort(sortFn);
      nodes.forEach((n: any) => {
        if (n[childrenKey]?.length) sortTree(n[childrenKey]);
      });
    };
    sortTree(result);
  }

  return result;
};

export const getRunner = (predicate: () => boolean, fn: (...args: any[]) => void, delay = 100, maxCounter = 100) => {
  let counter = 0;
  let stopped = false;
  const runner = (...args: any[]) => {
    if (stopped) return;
    if (predicate()) {
      fn(...args);
    } else {
      counter += 1;
      if (counter > maxCounter) {
        stopped = true;
      } else {
        setTimeout(() => runner(...args), delay);
      }
    }
  };
  return {
    run: runner,
    stop: () => {
      stopped = true;
    },
  };
};

const TooltipComponents = [Tooltip, Ellipsis];

const isTooltipComponent = (elm: React.ReactElement) => {
  if (TooltipComponents.includes(elm.type)) return true;
  return false;
};

const hasTooltipNode = (children: React.ReactNode) => {
  let result = false;
  Children.forEach(children, (child) => {
    if (child) {
      if (Array.isArray(child)) {
        if (hasTooltipNode(child)) result = true;
      } else if (React.isValidElement(child)) {
        if (isTooltipComponent(child)) {
          result = true;
        } else if (child.props.children) {
          if (hasTooltipNode(child.props.children)) result = true;
        }
      }
    }
  });
  return result;
};

export const ToolTipCell = (props: any) => {
  const { index, showAllContent, title, children, notooltip, tooltipPreserveLineBreak, ...rest } = props;
  if (!notooltip && title && !hasTooltipNode(children)) {
    return (
      <td {...rest}>
        <Tooltip
          title={title}
          color="#fff"
          styles={{
            body: {
              color: 'rgba(0,0,0,0.65)',
              ...(tooltipPreserveLineBreak ? { whiteSpace: 'pre' as const } : {}),
            },
          }}
        >
          {!React.isValidElement(children) ? (
            <span
              className={showAllContent ? 'showAll' : ''}
              style={{ maxWidth: '100%', display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis' }}
              data-index={String(index)}
            >
              {children}
            </span>
          ) : (
            children
          )}
        </Tooltip>
      </td>
    );
  }
  return <td {...rest}>{children}</td>;
};
