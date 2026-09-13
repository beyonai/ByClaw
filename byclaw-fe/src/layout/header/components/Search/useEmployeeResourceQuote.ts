import { useCallback, useEffect, useMemo } from 'react';
import { useIntl } from '@umijs/max';
import { message } from 'antd';
import { debounce } from 'lodash';
import { DragType, type IDragType } from '@/components/QueryInput/withDrag';
import type { ResourceItem } from '@/layout/sider/components/ResourceSiderPanel/ResourceSiderListItem';
import { resourceSiderTypeByTabKey } from './utils';

interface Options {
  eventEmitter: {
    emit: (eventName: string, payload?: any) => void;
  };
}

/** 引用元素的拖拽类型：资源面板/搜索结果只有 TOOL、SKILL 两类可引用，其余 tab 无可引用项。 */
const getResourceQuoteDragType = (tabKey: string): IDragType | null => {
  const resourceType = resourceSiderTypeByTabKey[tabKey];
  if (resourceType === 'TOOL') return DragType.tool;
  if (resourceType === 'SKILL') return DragType.SKILL;
  return null;
};

/**
 * 资源搜索结果的双击引用能力。
 *
 * 下钻与双击插入引用原先共用一个钩子；视图/对象下线后下钻链路已整体删除，
 * 故本钩子只保留仍被 TOOL/SKILL 使用的引用行为。
 */
const useEmployeeResourceQuote = ({ eventEmitter }: Options) => {
  const intl = useIntl();

  const emitEmployeeResourceInsert = useMemo(
    () =>
      debounce(
        (tabKey: string, item: ResourceItem) => {
          const type = getResourceQuoteDragType(tabKey);
          if (!type) {
            return;
          }

          eventEmitter.emit('queryInput-insert-item', {
            item: { ...item, isFromResourceModule: true },
            type,
          });
          message.success(intl.formatMessage({ id: 'search.referenceSuccess' }));
        },
        300,
        { leading: true, trailing: false }
      ),
    [eventEmitter, intl]
  );

  useEffect(() => () => emitEmployeeResourceInsert.cancel(), [emitEmployeeResourceInsert]);

  const handleEmployeeResourceDoubleClick = useCallback(
    (tabKey: string, item: ResourceItem) => {
      if (item.quoteDisabled) {
        return;
      }
      const type = getResourceQuoteDragType(tabKey);
      if (!type) {
        return;
      }

      emitEmployeeResourceInsert(tabKey, item);
    },
    [emitEmployeeResourceInsert]
  );

  return { handleEmployeeResourceDoubleClick };
};

export default useEmployeeResourceQuote;
