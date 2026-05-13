import { Button, Tabs, Input } from 'antd';
import { useIntl, useNavigate } from '@umijs/max';
import classNames from 'classnames';
import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { SearchOutlined } from '@ant-design/icons';
import { trim } from 'lodash';
import ResourceCitation from '@/components/Resources/components/ResourceCitation';
import Empty from '@/components/Empty';
import { ResourceType } from '../../utils/constants';
import { IResourceType } from '../../types';
import { ResourceTypeMap } from '@/constants/resource';
import { queryDigEmployeeRelResourceAuth } from '@/pages/manager/service/resources';
import { getDcSystemConfigListByStandType } from '@/service/auth';
import { DEFAULT_MENU_CONFIG, getVisibleMenuKeysFromConfig } from '@/constants/system';
import styles from './style.module.less';
import useGlobal from '@/hooks/useGlobal';

const defaultVisibleKeys = getVisibleMenuKeysFromConfig(DEFAULT_MENU_CONFIG);
interface Props {
  open?: boolean;
  keyword?: string;
  agentId?: string;
  sessionId?: string;
  header?: React.ReactNode;
  onSelect: (item: any, type: IResourceType) => void;
  showKnowledgeTab?: boolean;
  showSpaceTab?: boolean;
  showSkillTab?: boolean;
  agentIds?: string;
}

/** 「工具」Tab：不含对象类型 */
const TOOL_TAB_BIZ_TYPES = [ResourceTypeMap.Agent, ResourceTypeMap.MCP, ResourceTypeMap.TOOLKIT] as const;
const KNOWLEDGE_TAB_BIZ_TYPES = [ResourceTypeMap.knowledgeBase, ResourceTypeMap.knowledgeBaseQa] as const;

const ResourceTabs: React.FC<Props> = ({
  open,
  onSelect,
  keyword,
  header,
  agentId,
  sessionId,
  showKnowledgeTab,
  showSkillTab,
  agentIds,
}) => {
  const [activeTab, setActiveTab] = useState<string>();
  const [visibleKeys, setVisibleKeys] = useState<string[]>(defaultVisibleKeys);
  const initialKeyword = useMemo(() => trim(keyword || ''), [keyword]);
  const [searchValue, setSearchValue] = useState(initialKeyword);
  const [queryKeyword, setQueryKeyword] = useState(initialKeyword);
  const [sharedResources, setSharedResources] = useState<any[]>([]);
  const [sharedLoading, setSharedLoading] = useState(false);
  const sharedQueryKeyRef = useRef('');
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);

  const { layoutMode, agentInfo } = useGlobal();

  const { agentType } = agentInfo || {};

  useEffect(() => {
    getDcSystemConfigListByStandType({
      standType: 'MENU_ICON_SHOW_TAB',
    })
      .then((res: any) => {
        const configData = res?.data || res;
        if (Array.isArray(configData) && configData.length > 0) {
          const visibleMenuKeys = getVisibleMenuKeysFromConfig(configData);
          setVisibleKeys(visibleMenuKeys);
        }
      })
      .catch(() => {});
  }, []);

  // console.log('agentInfo111', agentInfo);

  const isDebug = layoutMode === 'debug';
  const intl = useIntl();

  const navigate = useNavigate();

  const resolvedSessionId = useMemo(() => trim(sessionId || ''), [sessionId]);
  const normalizedAgentId = useMemo(() => {
    if (!agentId) return agentId;
    return agentId.split('_').pop() || agentId;
  }, [agentId]);

  // const { userInfo } = useSelector((state: any) => state.user);
  // const usersOrganizations = userInfo?.usersOrganizations || [];
  // const userTypeList = usersOrganizations.map((item: any) => item.userType);
  // isEmpty(intersection(userTypeList, ['PLAT_MAN', 'PLAT_DEVOPS']));

  const onSelectTool = useCallback(
    (item: any) => {
      onSelect(item, ResourceType.tool);
    },
    [onSelect]
  );

  const onSelectObject = useCallback(
    (item: any) => {
      onSelect(item, ResourceType.OBJECT);
    },
    [onSelect]
  );

  const hasAnyTab = true;

  const shouldUseSharedResourceQuery = !!normalizedAgentId;

  useEffect(() => {
    setSearchValue(initialKeyword);
    setQueryKeyword(initialKeyword);
    sharedQueryKeyRef.current = '';
  }, [initialKeyword, normalizedAgentId, resolvedSessionId]);

  useEffect(() => {
    if (searchValue === queryKeyword) {
      return;
    }
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }
    debounceTimer.current = setTimeout(() => {
      const nextKeyword = trim(searchValue || '');
      setQueryKeyword((prev) => (prev === nextKeyword ? prev : nextKeyword));
    }, 400);
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [searchValue, queryKeyword]);

  const fetchSharedResources = useCallback(
    async (keywordValue: string, force = false) => {
      if (activeTab === 'space' || activeTab === 'skill') {
        return;
      }
      if (!shouldUseSharedResourceQuery) {
        setSharedResources([]);
        setSharedLoading(false);
        sharedQueryKeyRef.current = '';
        return;
      }
      const currentQueryKey = `${normalizedAgentId}::${keywordValue}`;
      if (!force && sharedQueryKeyRef.current === currentQueryKey) {
        return;
      }
      setSharedResources([]);
      setSharedLoading(true);
      try {
        const response = await queryDigEmployeeRelResourceAuth({
          resourceId: normalizedAgentId,
          keyword: keywordValue,
          pageNum: 1,
          pageSize: 100,
        });
        const rows = Array.isArray(response?.rows) ? response.rows : Array.isArray(response?.list) ? response.list : [];
        sharedQueryKeyRef.current = currentQueryKey;
        setSharedResources(rows);
      } catch (error) {
        setSharedResources([]);
        sharedQueryKeyRef.current = '';
        console.error('Failed to load digital employee related resources:', error);
      } finally {
        setSharedLoading(false);
      }
    },
    [normalizedAgentId, shouldUseSharedResourceQuery]
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    fetchSharedResources(initialKeyword, true);
  }, [open, fetchSharedResources, initialKeyword]);

  useEffect(() => {
    if (!activeTab) {
      return;
    }
    fetchSharedResources(queryKeyword);
  }, [activeTab, queryKeyword, fetchSharedResources]);

  const getSharedTabResources = useCallback(
    (bizTypes: readonly string[]) => {
      return sharedResources.filter((item: any) => bizTypes.includes(item.resourceBizType));
    },
    [sharedResources]
  );

  useEffect(() => {
    const visible: string[] = ['space'];
    if (visibleKeys.includes('knowledge')) visible.push('knowledge');
    if (visibleKeys.includes('tool')) visible.push('tool');
    if (visibleKeys.includes('view')) visible.push('view');
    if (visibleKeys.includes('object')) visible.push('object');
    visible.push('skill');
    if (!visible.length) return;
    const newActiveTabValue = activeTab && visible.includes(activeTab) ? activeTab : visible[0];
    setActiveTab(newActiveTabValue);
  }, [showKnowledgeTab, showSkillTab, agentIds, visibleKeys]);

  const tabItems = useMemo(() => {
    const items: {
      key: string;
      label: string;
      children: React.ReactNode;
    }[] = [];
    items.push({
      key: 'space',
      label: intl.formatMessage({ id: 'sider.space' }),
      children: (
        <div className={styles.listContainer}>
          <ResourceCitation
            resourceType="SPACE"
            onSelect={onSelectObject}
            keyword={queryKeyword}
            agentId={agentId}
            agentIds={agentIds}
          />
        </div>
      ),
    });
    items.push({
      key: 'knowledge',
      label: intl.formatMessage({ id: 'sider.knowledge' }),
      children: (
        <div className={styles.listContainer}>
          <ResourceCitation
            resourceType="KNOWLEDGE"
            onSelect={onSelectObject}
            keyword={queryKeyword}
            agentId={agentId}
            agentIds={agentIds}
            resourceBizTypeList={[...KNOWLEDGE_TAB_BIZ_TYPES]}
            resources={shouldUseSharedResourceQuery ? getSharedTabResources(KNOWLEDGE_TAB_BIZ_TYPES) : undefined}
            loadingOverride={shouldUseSharedResourceQuery ? sharedLoading : undefined}
          />
        </div>
      ),
    });
    items.push({
      key: 'object',
      label: intl.formatMessage({ id: 'common.object' }),
      children: (
        <div className={styles.listContainer}>
          <ResourceCitation
            resourceType="OBJECT"
            onSelect={onSelectObject}
            keyword={queryKeyword}
            agentId={agentId}
            agentIds={agentIds}
            resourceBizTypeList={[ResourceTypeMap.OBJECT]}
            resources={shouldUseSharedResourceQuery ? getSharedTabResources([ResourceTypeMap.OBJECT]) : undefined}
            loadingOverride={shouldUseSharedResourceQuery ? sharedLoading : undefined}
          />
        </div>
      ),
    });
    items.push({
      key: 'tool',
      label: intl.formatMessage({ id: 'common.tool' }),
      children: (
        <div className={styles.listContainer}>
          <ResourceCitation
            resourceType="TOOL"
            onSelect={onSelectTool}
            keyword={queryKeyword}
            agentId={agentId}
            agentIds={agentIds}
            resourceBizTypeList={[...TOOL_TAB_BIZ_TYPES]}
            disableClick={true}
            resources={shouldUseSharedResourceQuery ? getSharedTabResources(TOOL_TAB_BIZ_TYPES) : undefined}
            loadingOverride={shouldUseSharedResourceQuery ? sharedLoading : undefined}
          />
        </div>
      ),
    });
    items.push({
      key: 'view',
      label: intl.formatMessage({ id: 'common.viewName' }),
      children: (
        <div className={styles.listContainer}>
          <ResourceCitation
            resourceType="VIEW"
            onSelect={onSelectObject}
            keyword={queryKeyword}
            agentId={agentId}
            agentIds={agentIds}
            resourceBizTypeList={[ResourceTypeMap.VIEW]}
            resources={shouldUseSharedResourceQuery ? getSharedTabResources([ResourceTypeMap.VIEW]) : undefined}
            loadingOverride={shouldUseSharedResourceQuery ? sharedLoading : undefined}
          />
        </div>
      ),
    });
    items.push({
      key: 'skill',
      label: intl.formatMessage({ id: 'common.skill' }),
      children: (
        <div className={styles.listContainer}>
          <ResourceCitation
            resourceType="SKILL"
            onSelect={onSelectObject}
            keyword={queryKeyword}
            agentId={agentId}
            agentIds={agentIds}
          />
        </div>
      ),
    });
    return items;
  }, [
    intl,
    onSelect,
    onSelectObject,
    onSelectTool,
    queryKeyword,
    agentId,
    agentIds,
    showKnowledgeTab,
    showSkillTab,
    shouldUseSharedResourceQuery,
    sharedLoading,
    getSharedTabResources,
    resolvedSessionId,
  ]);

  const visibleTabs = useMemo(() => {
    const baseTabs = [
      {
        key: 'space',
        label: intl.formatMessage({ id: 'sider.space' }),
      },
    ];

    const conditionalTabs = [
      {
        key: 'knowledge',
        label: intl.formatMessage({ id: 'sider.knowledge' }),
      },
      {
        key: 'tool',
        label: intl.formatMessage({ id: 'common.tool' }),
      },
      {
        key: 'view',
        label: intl.formatMessage({ id: 'common.viewName' }),
      },
      {
        key: 'object',
        label: intl.formatMessage({ id: 'common.object' }),
      },
    ];

    const skillTab = {
      key: 'skill',
      label: intl.formatMessage({ id: 'common.skill' }),
    };

    const filteredConditionalTabs = conditionalTabs.filter((tab) => {
      if (agentType === '005') {
        return !['knowledge', 'tool'].includes(tab.key);
      }
      if (agentType === '006') {
        return !['tool', 'view', 'object'].includes(tab.key);
      }
      return visibleKeys.includes(tab.key);
    });

    return [...baseTabs, ...filteredConditionalTabs, skillTab];
  }, [agentType, intl, visibleKeys]);

  if (!hasAnyTab) {
    return (
      <div className={styles.wrap}>
        <Empty />
      </div>
    );
  }

  return (
    <div className={styles.wrap} style={{ width: isDebug ? '100vw' : '1100px' }}>
      {header}
      <div className={classNames(styles.headerRow, 'full-width')}>
        <Tabs
          className={classNames(styles.tabButtons, 'full-width')}
          activeKey={activeTab}
          items={visibleTabs}
          onChange={setActiveTab}
          size={isDebug ? 'small' : 'middle'}
          tabBarExtraContent={
            <div className={styles.searchRow}>
              <Input
                allowClear
                disabled={!!keyword}
                placeholder={intl.formatMessage({ id: 'selectMember.searchPlaceholder' })}
                className={styles.searchInput}
                suffix={<SearchOutlined />}
                value={searchValue}
                onChange={(e) => {
                  setSearchValue(e.target.value);
                }}
                onBlur={() => {
                  const nextKeyword = trim(searchValue || '');
                  if (nextKeyword !== queryKeyword) {
                    if (debounceTimer.current) {
                      clearTimeout(debounceTimer.current);
                    }
                    setQueryKeyword(nextKeyword);
                  }
                }}
                onPressEnter={() => {
                  const nextKeyword = trim(searchValue || '');
                  if (nextKeyword !== queryKeyword) {
                    if (debounceTimer.current) {
                      clearTimeout(debounceTimer.current);
                    }
                    setQueryKeyword(nextKeyword);
                  }
                }}
              />
              {!isDebug && activeTab !== 'space' && activeTab !== 'skill' && (
                <Button
                  type="text"
                  onClick={() => {
                    const routeMap: Record<string, string> = {
                      knowledge: '/knowledgeCenter?tab=enterprise',
                      object: '/objectCenter?tab=enterprise',
                      view: '/viewCenter?tab=enterprise',
                      tool: '/toolCenter?tab=enterprise',
                    };
                    const route = activeTab ? routeMap[activeTab] || '/workspace' : '/workspace';
                    navigate(route);
                  }}
                >
                  {activeTab === 'knowledge' && intl.formatMessage({ id: 'resourceTabs.knowledgeCenter' })}
                  {activeTab === 'object' && intl.formatMessage({ id: 'resourceTabs.objectCenter' })}
                  {activeTab === 'view' && intl.formatMessage({ id: 'resourceTabs.viewCenter' })}
                  {activeTab === 'tool' && intl.formatMessage({ id: 'resourceTabs.toolCenter' })}
                </Button>
              )}
            </div>
          }
        />
      </div>
      <div className={styles.tabsWrap}>
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          destroyInactiveTabPane
          tabBarStyle={{ display: 'none' }}
          items={tabItems.map(({ key, label, children }) => ({ key, label, children }))}
        />
      </div>
    </div>
  );
};

export default ResourceTabs;
