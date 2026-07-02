import { useCallback, useMemo, useState } from 'react';
import { debounce } from 'lodash';
import { useIntl } from '@umijs/max';
import { queryDigEmployeeRelResourceAuth } from '@/pages/manager/service/resources';
import {
  EMPLOYEE_RESOURCE_TAB_KEYS,
  employeeResourceBizTypeListByTabKey,
  employeeResourceTabLabelIdByTabKey,
} from '@/layout/sider/employeeResourceTabs';
import { getArrayData } from './utils';
import type { EmployeeResourceTab, EmployeeResourceTabConfig } from './types';

interface Options {
  visibleKeys: string[];
  activeSiderAgentResourceId?: string;
}

const useEmployeeResourceSearch = ({ visibleKeys, activeSiderAgentResourceId }: Options) => {
  const intl = useIntl();
  const [employeeResourceResultMap, setEmployeeResourceResultMap] = useState<Record<string, any[]>>({});

  const visibleEmployeeResourceTabKeyText = useMemo(
    () => visibleKeys.filter((key: string) => EMPLOYEE_RESOURCE_TAB_KEYS.has(key)).join(','),
    [visibleKeys]
  );

  const visibleEmployeeResourceTabConfigs = useMemo(
    () =>
      visibleEmployeeResourceTabKeyText
        .split(',')
        .filter(Boolean)
        .map((key: string) => {
          const resourceBizTypeList = employeeResourceBizTypeListByTabKey[key];
          const labelId = employeeResourceTabLabelIdByTabKey[key];

          if (!resourceBizTypeList?.length || !labelId) {
            return null;
          }

          return {
            key,
            labelId,
            resourceBizTypeList,
          };
        })
        .filter(Boolean) as EmployeeResourceTabConfig[],
    [visibleEmployeeResourceTabKeyText]
  );

  const visibleEmployeeResourceTabs = useMemo(
    () =>
      visibleEmployeeResourceTabConfigs.map((tab) => ({
        ...tab,
        title: intl.formatMessage({ id: tab.labelId }),
      })),
    [intl, visibleEmployeeResourceTabConfigs]
  );

  const myGetEmployeeResourceList = useCallback(
    debounce((myKeyword: string) => {
      if (!activeSiderAgentResourceId || visibleEmployeeResourceTabConfigs.length === 0) {
        setEmployeeResourceResultMap((current) => (Object.keys(current).length === 0 ? current : {}));
        return;
      }

      Promise.allSettled(
        visibleEmployeeResourceTabConfigs.map((tab) =>
          queryDigEmployeeRelResourceAuth({
            pageNum: 1,
            pageSize: 20,
            keyword: myKeyword.trim(),
            resourceId: activeSiderAgentResourceId,
            resourceBizTypeList: tab.resourceBizTypeList,
          }).then((response) => ({
            tabKey: tab.key,
            list: getArrayData(response),
          }))
        )
      )
        .then((results) => {
          const nextResultMap: Record<string, any[]> = {};

          results.forEach((resultItem) => {
            if (resultItem.status === 'fulfilled') {
              nextResultMap[resultItem.value.tabKey] = resultItem.value.list;
            }
          });

          setEmployeeResourceResultMap(nextResultMap);
        })
        .catch(() => {
          setEmployeeResourceResultMap({});
        });
    }, 300),
    [activeSiderAgentResourceId, visibleEmployeeResourceTabConfigs]
  );

  const cancelEmployeeResourceSearch = useCallback(() => {
    myGetEmployeeResourceList.cancel();
  }, [myGetEmployeeResourceList]);

  return {
    employeeResourceResultMap,
    visibleEmployeeResourceTabs: visibleEmployeeResourceTabs as EmployeeResourceTab[],
    myGetEmployeeResourceList,
    cancelEmployeeResourceSearch,
  };
};

export default useEmployeeResourceSearch;
