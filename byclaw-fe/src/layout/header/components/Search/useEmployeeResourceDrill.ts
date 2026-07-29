import { useCallback, useEffect, useMemo, useState } from 'react';
import { useIntl } from '@umijs/max';
import { message } from 'antd';
import { debounce } from 'lodash';
import { queryResourceMembers } from '@/pages/manager/service/resources';
import type { ResourceItem } from '@/layout/sider/components/ResourceSiderPanel/ResourceSiderListItem';
import type { EmployeeResourceDrillState, EmployeeResourceTab } from './types';
import { getEmployeeResourceDrillItems, getEmployeeResourceQuoteType } from './utils';

interface Options {
  visibleEmployeeResourceTabs: EmployeeResourceTab[];
  employeeResourceResultMap: Record<string, any[]>;
  eventEmitter: {
    emit: (eventName: string, payload?: any) => void;
  };
  setActiveTab: (title: string) => void;
}

const useEmployeeResourceDrill = ({
  visibleEmployeeResourceTabs,
  employeeResourceResultMap,
  eventEmitter,
  setActiveTab,
}: Options) => {
  const intl = useIntl();
  const [employeeResourceDrillState, setEmployeeResourceDrillState] = useState<EmployeeResourceDrillState | null>(null);
  const [employeeResourceDrillLoading, setEmployeeResourceDrillLoading] = useState(false);

  const resetEmployeeResourceDrill = useCallback(() => {
    setEmployeeResourceDrillState(null);
    setEmployeeResourceDrillLoading(false);
  }, []);

  const emitEmployeeResourceInsert = useMemo(
    () =>
      debounce(
        (tabKey: string, item: ResourceItem) => {
          const type = getEmployeeResourceQuoteType(tabKey);
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
      const type = getEmployeeResourceQuoteType(tabKey);
      if (!type) {
        return;
      }

      emitEmployeeResourceInsert(tabKey, item);
    },
    [emitEmployeeResourceInsert]
  );

  const getEmployeeResourceDrillable = useCallback(
    (tabKey: string, item: ResourceItem) => {
      if (tabKey !== 'view' && tabKey !== 'object') {
        return false;
      }
      if (employeeResourceDrillState?.tabKey !== tabKey) {
        return true;
      }
      return !!item.resourceCode && !String(item.resourceId).includes('-');
    },
    [employeeResourceDrillState?.tabKey]
  );

  const handleEmployeeResourceItemClick = useCallback(
    async (tabKey: string, item: ResourceItem, drillable: boolean) => {
      if (!drillable || !item.resourceId) {
        return;
      }

      const activeResourceTab = visibleEmployeeResourceTabs.find((tab) => tab.key === tabKey);
      if (activeResourceTab) {
        setActiveTab(activeResourceTab.title);
      }

      const previousList =
        employeeResourceDrillState?.tabKey === tabKey
          ? employeeResourceDrillState.list
          : employeeResourceResultMap[tabKey] || [];
      const previousBreadcrumb =
        employeeResourceDrillState?.tabKey === tabKey ? employeeResourceDrillState.breadcrumb : [];

      setEmployeeResourceDrillLoading(true);
      try {
        const detail = await queryResourceMembers({ resourceId: item.resourceId });
        const detailDrillItems = getEmployeeResourceDrillItems({ ...detail, quoteDisabled: item.quoteDisabled });
        const drillItems = detailDrillItems.length ? detailDrillItems : getEmployeeResourceDrillItems(item);

        setEmployeeResourceDrillState({
          tabKey,
          breadcrumb: [
            ...previousBreadcrumb,
            {
              item,
              list: previousList,
            },
          ],
          list: drillItems,
        });
      } catch (error) {
        console.error('Error fetching employee resource drill detail:', error);
      } finally {
        setEmployeeResourceDrillLoading(false);
      }
    },
    [employeeResourceDrillState, employeeResourceResultMap, setActiveTab, visibleEmployeeResourceTabs]
  );

  const handleEmployeeResourceGoBack = useCallback(() => {
    setEmployeeResourceDrillState((current) => {
      if (!current) {
        return current;
      }
      const previousBreadcrumb = current.breadcrumb.slice(0, -1);
      const previous = current.breadcrumb[current.breadcrumb.length - 1];
      if (!previousBreadcrumb.length) {
        return null;
      }
      return {
        tabKey: current.tabKey,
        breadcrumb: previousBreadcrumb,
        list: previous.list,
      };
    });
  }, []);

  return {
    employeeResourceDrillState,
    employeeResourceDrillLoading,
    resetEmployeeResourceDrill,
    getEmployeeResourceDrillable,
    handleEmployeeResourceItemClick,
    handleEmployeeResourceDoubleClick,
    handleEmployeeResourceGoBack,
  };
};

export default useEmployeeResourceDrill;
