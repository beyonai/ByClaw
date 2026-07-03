import { useCallback, useMemo, useState } from 'react';
import { debounce } from 'lodash';
import { useIntl } from '@umijs/max';
import { listResourceUseAuth, queryDigEmployeeRelResourceAuth } from '@/pages/manager/service/resources';
import {
  EMPLOYEE_RESOURCE_TAB_KEYS,
  employeeResourceBizTypeListByTabKey,
  employeeResourceTabLabelIdByTabKey,
} from '@/layout/sider/employeeResourceTabs';
import { getArrayData, normalizeKnowledgeResourceItem, normalizeResourceItem } from './utils';
import type { EmployeeResourceGroup, EmployeeResourceTab, EmployeeResourceTabConfig } from './types';

interface Options {
  visibleKeys: string[];
  activeSiderAgentResourceId?: string;
}

const getResourceCenterListFilterParams = (ownerType: 'personal' | 'enterprise') => {
  const params = {
    resourceStatus: '2',
    permission: '',
  };

  if (ownerType === 'personal') {
    return params;
  }

  return {
    ...params,
    belong: 'ALL',
  };
};

const normalizeKnowledgeResourceList = (list: any[], quoteDisabled: boolean) =>
  list.map((item) => normalizeKnowledgeResourceItem(item, { quoteDisabled }));

const normalizeEmployeeResourceList = (list: any[], quoteDisabled: boolean) =>
  list.map((item) => ({
    ...normalizeResourceItem(item),
    quoteDisabled,
  }));

const resourceGroupTitleIdByTabKey: Record<string, Record<EmployeeResourceGroup['key'], string>> = {
  knowledge: {
    current: 'headerSearch.currentKnowledge',
    personal: 'headerSearch.personalKnowledge',
    enterprise: 'headerSearch.enterpriseKnowledge',
  },
  tool: {
    current: 'headerSearch.currentTool',
    personal: 'headerSearch.personalTool',
    enterprise: 'headerSearch.enterpriseTool',
  },
  view: {
    current: 'headerSearch.currentView',
    personal: 'headerSearch.personalView',
    enterprise: 'headerSearch.enterpriseView',
  },
  object: {
    current: 'headerSearch.currentObject',
    personal: 'headerSearch.personalObject',
    enterprise: 'headerSearch.enterpriseObject',
  },
  skill: {
    current: 'headerSearch.currentSkill',
    personal: 'headerSearch.personalSkill',
    enterprise: 'headerSearch.enterpriseSkill',
  },
};

const useEmployeeResourceSearch = ({ visibleKeys, activeSiderAgentResourceId }: Options) => {
  const intl = useIntl();
  const [employeeResourceResultMap, setEmployeeResourceResultMap] = useState<Record<string, any[]>>({});
  const [employeeResourceGroupMap, setEmployeeResourceGroupMap] = useState<Record<string, EmployeeResourceGroup[]>>({});

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

  const buildEmployeeResourceGroups = useCallback(
    (tabKey: string, { current = [], personal = [], enterprise = [] }: Record<EmployeeResourceGroup['key'], any[]>) => {
      const titleIdMap = resourceGroupTitleIdByTabKey[tabKey] || resourceGroupTitleIdByTabKey.knowledge;

      return [
        {
          key: 'current' as const,
          title: intl.formatMessage({ id: titleIdMap.current }),
          description: intl.formatMessage({ id: 'headerSearch.quotableTip' }),
          list: current,
          quoteDisabled: false,
        },
        {
          key: 'personal' as const,
          title: intl.formatMessage({ id: titleIdMap.personal }),
          list: personal,
          quoteDisabled: true,
        },
        {
          key: 'enterprise' as const,
          title: intl.formatMessage({ id: titleIdMap.enterprise }),
          list: enterprise,
          quoteDisabled: true,
        },
      ].filter((group) => group.list.length > 0);
    },
    [intl]
  );

  const myGetEmployeeResourceList = useCallback(
    debounce((myKeyword: string) => {
      if (!activeSiderAgentResourceId || visibleEmployeeResourceTabConfigs.length === 0) {
        setEmployeeResourceResultMap((current) => (Object.keys(current).length === 0 ? current : {}));
        setEmployeeResourceGroupMap((current) => (Object.keys(current).length === 0 ? current : {}));
        return;
      }

      Promise.allSettled(
        visibleEmployeeResourceTabConfigs.map((tab) => {
          const currentResourceRequest = queryDigEmployeeRelResourceAuth({
            pageNum: 1,
            pageSize: 20,
            keyword: myKeyword.trim(),
            resourceId: activeSiderAgentResourceId,
            resourceBizTypeList: tab.resourceBizTypeList,
          }).then((response) => ({
            tabKey: tab.key,
            list: getArrayData(response),
          }));

          return Promise.allSettled([
            currentResourceRequest,
            listResourceUseAuth({
              pageNum: 1,
              pageSize: 20,
              keyword: myKeyword.trim(),
              ownerType: 'personal',
              ...getResourceCenterListFilterParams('personal'),
              resourceBizTypeList: tab.resourceBizTypeList,
            }),
            listResourceUseAuth({
              pageNum: 1,
              pageSize: 20,
              keyword: myKeyword.trim(),
              ownerType: 'enterprise',
              ...getResourceCenterListFilterParams('enterprise'),
              resourceBizTypeList: tab.resourceBizTypeList,
            }),
          ]).then(([currentResult, personalResult, enterpriseResult]) => {
            const normalizeList =
              tab.key === 'knowledge' ? normalizeKnowledgeResourceList : normalizeEmployeeResourceList;
            const currentList =
              currentResult.status === 'fulfilled' ? normalizeList(currentResult.value.list, false) : [];
            const personalList =
              personalResult.status === 'fulfilled' ? normalizeList(getArrayData(personalResult.value), true) : [];
            const enterpriseList =
              enterpriseResult.status === 'fulfilled' ? normalizeList(getArrayData(enterpriseResult.value), true) : [];

            return {
              tabKey: tab.key,
              list: [...currentList, ...personalList, ...enterpriseList],
              groups: buildEmployeeResourceGroups(tab.key, {
                current: currentList,
                personal: personalList,
                enterprise: enterpriseList,
              }),
            };
          });
        })
      )
        .then((results) => {
          const nextResultMap: Record<string, any[]> = {};
          const nextEmployeeResourceGroupMap: Record<string, EmployeeResourceGroup[]> = {};

          results.forEach((resultItem) => {
            if (resultItem.status === 'fulfilled') {
              nextResultMap[resultItem.value.tabKey] = resultItem.value.list;
              nextEmployeeResourceGroupMap[resultItem.value.tabKey] = resultItem.value.groups || [];
            }
          });

          setEmployeeResourceResultMap(nextResultMap);
          setEmployeeResourceGroupMap(nextEmployeeResourceGroupMap);
        })
        .catch(() => {
          setEmployeeResourceResultMap({});
          setEmployeeResourceGroupMap({});
        });
    }, 300),
    [activeSiderAgentResourceId, buildEmployeeResourceGroups, visibleEmployeeResourceTabConfigs]
  );

  const cancelEmployeeResourceSearch = useCallback(() => {
    myGetEmployeeResourceList.cancel();
  }, [myGetEmployeeResourceList]);

  return {
    employeeResourceResultMap,
    employeeResourceGroupMap,
    knowledgeResourceGroups: employeeResourceGroupMap.knowledge || [],
    visibleEmployeeResourceTabs: visibleEmployeeResourceTabs as EmployeeResourceTab[],
    myGetEmployeeResourceList,
    cancelEmployeeResourceSearch,
  };
};

export default useEmployeeResourceSearch;
