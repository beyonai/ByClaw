import React, { useCallback, useContext, useState, useEffect, useRef } from 'react';
import {
  CheckOutlined,
  DownOutlined,
  FullscreenOutlined,
  LeftOutlined,
  PlusOutlined,
  SearchOutlined,
  UnorderedListOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useIntl, useLocation, useSelector, useNavigate, useSearchParams } from '@umijs/max';
import type { TabsProps } from 'antd';
import { Badge, Button, Dropdown, Empty, Input, Segmented, Select, Space, Spin, Tooltip, message } from 'antd';
import classnames from 'classnames';
import AntdIcon from '@/components/AntdIcon';
import useModuleEvent from '@/hooks/useModuleEvent';
import CommonTabs from '@/components/CommonTabs';
import { getRuntimeActualUrl } from '@/utils';
import { getLocalizedCatalogName, getTopLevelCatalogs, normalizeCatalogTree } from '@/utils/catalog';
import { queryCatalogTree, updateResource } from '@/service/digitalEmployees';
import { queryKnowledgeCapability, type KnowledgeCapability } from '@/service/knowledgeCenter';
import {
  applyResourceUse,
  queryResourceUseApplyAudit,
  queryFixedEntryOperationCapability,
  type FixedEntryOperationCapability,
} from '@/pages/manager/service/resources';
import type { SkillGroup } from '@/pages/manager/service/resources';
import { getDcSystemConfig } from '@/pages/manager/service/session';
import ResourceEdit from './components/ResourceEdit';
import ResourceImport from './components/ResourceImport';
import SkillGroupCreateModal from './components/SkillGroupCreateModal';
import ResourceDetail from './components/ResourceDetail';
import AuthListDrawer from '@/pages/manager/components/AuthListDrawer';
import UseApplyAuditDrawer from '@/pages/manager/components/UseApplyAuditDrawer';
import DetailPanel from '@/pages/knowledgeCenter/components/DetailPanel';
import SkillDetailDrawer from '@/pages/manager/components/SkillDetailDrawer/SkillDetailDrawer';
import { useSkillDetailDrawer } from '@/pages/manager/components/SkillDetailDrawer/useSkillDetailDrawer';
import ResourceFilter from './components/ResourceFilter';
import { statusOptions, myResourceStatusOptions } from './constants';
import { getDefaultParams } from './components/ResourceFilter';
import ResourceList from './components/ResourceList';
import SkillGroupList from './components/SkillGroupList';
import { saveTool } from '@/pages/manager/service/DigitalEmployeeMgr';
import { resourceBizTypeMap } from '@/constants/knowledge';
import { SiderContentContext } from '@/layout/sider/siderContentContext';
import useGlobal from '@/hooks/useGlobal';
import type { IState as IEmployeesState } from '@/models/useEmployees';
import { getToken, isAdminVip } from '@/utils/auth';
import { get, trim, intersection, isEmpty } from 'lodash';
import {
  buildSkillMarketplaceUrl,
  filterResourceAuditRowsByType,
  getBaseResourceBizTypeList,
  getResourceQueryStatus,
  isSkillMarketplaceInstalledMessage,
} from './utils';
import ResourceAuditCenter from './components/ResourceAuditCenter';
import styles from './index.module.less';

interface IResourceItem {
  resourceName: string;
  resourceId: string;
  description?: string;
  resourceDesc?: string;
  resourceLogoUrl?: string;
  createUserName?: string;
  createTime?: number | string;
  resourceBizType?: string;
  resourceSourcePkId?: string;
  catalogId?: string | number;
  hasManagePermission?: boolean;
  hasUsePermission?: boolean;
  canViewDetail?: boolean;
  canEdit?: boolean;
  canManageAuth?: boolean;
  canDelete?: boolean;
  canApplyUse?: boolean;
  skillType?: string;
  sourceType?: string;
  version?: string;
  skillUrl?: string;
  skillPackageFormat?: string;
  skillOriginalFilename?: string;
  skillPackageSize?: number | string;
  skillPackageHash?: string;
  targetContent?: string;
  syncStatus?: string;
  syncError?: string;
  lastSyncTime?: string;
  ownerType?: string;
}

interface Props {
  resourceType: string; // 对应资源类型
  myResourcesOnly?: boolean;
  onMyResourcesOnlyChange?: (myResourcesOnly: boolean) => void;
}

const getBannerUrl = (bannerList: any[], labels: string | string[]) => {
  const labelList = Array.isArray(labels) ? labels : [labels];
  const banner = bannerList.find((item) => labelList.includes(item?.label));
  return `${banner?.url ?? ''}`.trim().replace(/^`|`$/g, '').trim();
};

const parseBannerList = (value: any) => {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== 'string' || !value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const Resources: React.FC<Props> = ({ resourceType, myResourcesOnly = false, onMyResourcesOnlyChange }) => {
  const intl = useIntl();
  const { EventEmitter, agentId, agentInfo } = useGlobal();

  // 根据 resourceType 判断资源名称
  const getResourceName = () => {
    if (resourceType === 'KG_DOC') return intl.formatMessage({ id: 'resource.knowledge' });
    if (resourceType === 'TOOL') return intl.formatMessage({ id: 'common.tool' });
    if (resourceType === 'SKILL') return intl.formatMessage({ id: 'common.skill' });
    return intl.formatMessage({ id: 'resource.default' }); // 默认值
  };
  const resourceName = getResourceName();
  const knowledgeCapabilityDisabledTip = intl.formatMessage({ id: 'resource.thirdPartyKnowledgeBaseMode' });
  const noPermissionDisabledTip = intl.formatMessage({ id: 'common.noPermissionOperation' });
  const navigate = useNavigate();
  const location = useLocation();
  const { placeholder: skillDetailDrawerHolder, show: showSkillDetailDrawer } = useSkillDetailDrawer();
  const [searchParams, setSearchParams] = useSearchParams();

  const [importModalOpen, setImportModalOpen] = useState(false);
  const [skillGroupCreateModalOpen, setSkillGroupCreateModalOpen] = useState(false);
  const [skillGroupEditing, setSkillGroupEditing] = useState<SkillGroup | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [detailPanelOpen, setDetailPanelOpen] = useState(false);
  const [currentItem, setCurrentItem] = useState<IResourceItem | null>(null);
  const [catalogId, setCatalogId] = useState<string>('');
  const [searchValue, setSearchValue] = useState('');
  const [debouncedSearchValue, setDebouncedSearchValue] = useState('');
  const [enterpriseSkillDropdownOpen, setEnterpriseSkillDropdownOpen] = useState(false);
  const [catalogList, setCatalogList] = useState<
    Array<{ catalogId: string | number; catalogName: string; pcatalogId?: string | number }>
  >([]);

  type ResourceTab = 'personal' | 'enterprise' | 'marketplace' | 'audit';
  type MyResourceScope = 'all' | 'created' | 'managed';
  const defaultTab = (): ResourceTab => {
    if (myResourcesOnly) {
      return 'personal';
    }
    const tabFromUrl = searchParams.get('tab');
    if (
      tabFromUrl === 'enterprise' ||
      tabFromUrl === 'personal' ||
      (resourceType === 'SKILL' && tabFromUrl === 'marketplace')
    ) {
      return tabFromUrl;
    }
    return 'personal';
  };

  const [activeTab, setActiveTab] = useState<ResourceTab>(defaultTab());
  const [myResourceScope, setMyResourceScope] = useState<MyResourceScope>('all');
  const enterpriseSkillKind = searchParams.get('kind') === 'group' ? 'group' : 'skill';
  const isEnterpriseSkillGroupMode =
    !myResourcesOnly && resourceType === 'SKILL' && activeTab === 'enterprise' && enterpriseSkillKind === 'group';
  const marketplaceRef = useRef<HTMLDivElement>(null);
  const marketplaceIframeRef = useRef<HTMLIFrameElement>(null);
  const [skillMarketplaceBaseUrl, setSkillMarketplaceBaseUrl] = useState('');
  const [skillMarketplaceConfigLoaded, setSkillMarketplaceConfigLoaded] = useState(resourceType !== 'SKILL');
  const { setDetailPanel, clearDetailPanel } = useContext(SiderContentContext);

  useEffect(() => {
    const tabFromUrl = searchParams.get('tab');
    if (myResourcesOnly) {
      if (activeTab !== 'personal' && activeTab !== 'enterprise' && activeTab !== 'audit') {
        setActiveTab('personal');
      }
      return;
    }
    if (
      (tabFromUrl === 'enterprise' ||
        tabFromUrl === 'personal' ||
        (resourceType === 'SKILL' && tabFromUrl === 'marketplace')) &&
      tabFromUrl !== activeTab
    ) {
      setActiveTab(tabFromUrl);
    }
    if (activeTab === 'audit') {
      setActiveTab('personal');
    }
  }, [activeTab, myResourcesOnly, resourceType, searchParams]);

  const { logoutModuleEvent } = useModuleEvent('KNOWLEDGE_CENTER');

  const { userInfo, defaultDigEmployeeId } = useSelector(
    ({ user, employees }: { user: any; employees: IEmployeesState }) => ({
      userInfo: user?.userInfo,
      defaultDigEmployeeId: employees.defaultDigEmployeeId,
    })
  );
  // 企业技能组浏览需要当前生效的数字员工，取值顺序与 ResourceList/ResourceCard 保持一致，
  // 否则同一页面内技能组与技能列表会落到不同员工。
  const activeDigitalEmployeeId =
    agentId || agentInfo?.agentId || defaultDigEmployeeId || userInfo?.defaultDigEmployeeId;
  const portalOrigin = typeof window === 'undefined' ? undefined : window.location.origin;
  const beyondToken = getToken();
  const skillMarketplaceUrl = React.useMemo(
    () => buildSkillMarketplaceUrl(skillMarketplaceBaseUrl, beyondToken, portalOrigin),
    [beyondToken, portalOrigin, skillMarketplaceBaseUrl]
  );
  const usersOrganizations = get(userInfo, 'usersOrganizations') || [];
  const userTypeList = usersOrganizations.map((item: any) => item.userType);
  const isAdmin = !isEmpty(intersection(userTypeList, ['PLAT_MAN', 'PLAT_DEVOPS']));

  const [authDrawerOpen, setAuthDrawerOpen] = useState(false);
  const [selectRecord, setSelectRecord] = useState<any>(null);
  const [authType, setAuthType] = useState<'useAuth' | 'mgrAuth'>('useAuth');
  const [useApplyAuditOpen, setUseApplyAuditOpen] = useState(false);
  const [dropdownParam, setDropdownParam] = useState<any>(getDefaultParams());
  const [refreshKey, setRefreshKey] = useState(0);
  const [knowledgeCapability, setKnowledgeCapability] = useState<KnowledgeCapability | null>(null);
  const [fixedEntryCapability, setFixedEntryCapability] = useState<FixedEntryOperationCapability | null>(null);
  const [brandVersion, setBrandVersion] = useState<'commercial' | 'openSource' | null>(null);
  const [brandVersionLoaded, setBrandVersionLoaded] = useState(false);
  const [bannerList, setBannerList] = useState<any[]>([]);
  const [bannerLoaded, setBannerLoaded] = useState(false);
  const [myResourceAuditPendingCount, setMyResourceAuditPendingCount] = useState(0);

  useEffect(() => {
    // 进入“我的资源”时从个人页签和“全部”范围开始，避免沿用普通资源中心的市场/企业筛选状态。
    setActiveTab((currentTab) => (myResourcesOnly ? 'personal' : currentTab === 'audit' ? 'personal' : currentTab));
    setMyResourceScope('all');
    setCatalogId('');
    setSearchValue('');
    setDebouncedSearchValue('');
    setDropdownParam(getDefaultParams());
  }, [myResourcesOnly]);

  const topLevelCatalogList = React.useMemo(() => getTopLevelCatalogs(catalogList), [catalogList]);
  const refreshList = useCallback(() => {
    setRefreshKey((prevKey) => prevKey + 1);
  }, []);

  const auditResourceBizTypeList = React.useMemo(() => getBaseResourceBizTypeList(resourceType), [resourceType]);

  useEffect(() => {
    // 外部入口和审核中心共用待审核数量，进入管理页前也需要查询。
    let active = true;
    setMyResourceAuditPendingCount(0);
    queryResourceUseApplyAudit({ history: false, resourceBizTypeList: auditResourceBizTypeList })
      .then((response: any) => {
        if (!active) return;
        const data = response?.data?.data ?? response?.data ?? response;
        const rows = Array.isArray(data) ? data : data?.list || data?.rows || [];
        // 与审核中心一致，忽略缺少资源标识的无效记录。
        setMyResourceAuditPendingCount(
          filterResourceAuditRowsByType(rows, auditResourceBizTypeList).filter(
            (item: any) => item?.resourceId !== undefined && item?.resourceId !== null
          ).length
        );
      })
      .catch(() => {
        if (active) {
          setMyResourceAuditPendingCount(0);
        }
      });
    return () => {
      active = false;
    };
  }, [auditResourceBizTypeList, myResourcesOnly, refreshKey]);

  const notifySiderResourceListReload = useCallback(() => {
    EventEmitter.emit('beyond-resourceList-resourceType-reload', {
      resourceType,
      resetSkillFilters: false,
      skipResourceCenterRefresh: true,
    });
  }, [EventEmitter, resourceType]);

  useEffect(() => {
    if (resourceType !== 'SKILL' || !skillMarketplaceUrl) {
      return;
    }

    const marketplaceOrigin = new URL(skillMarketplaceUrl).origin;
    const handleSkillMarketplaceMessage = (event: MessageEvent) => {
      if (event.origin !== marketplaceOrigin || event.source !== marketplaceIframeRef.current?.contentWindow) {
        return;
      }
      if (!isSkillMarketplaceInstalledMessage(event.data)) {
        return;
      }
      notifySiderResourceListReload();
    };

    window.addEventListener('message', handleSkillMarketplaceMessage);
    return () => {
      window.removeEventListener('message', handleSkillMarketplaceMessage);
    };
  }, [notifySiderResourceListReload, resourceType, skillMarketplaceUrl]);

  useEffect(() => {
    if (resourceType !== 'SKILL') {
      return;
    }

    let active = true;
    setSkillMarketplaceConfigLoaded(false);
    getDcSystemConfig({ paramCode: 'WHALE_AGENT_SKILL_MARKET_URL' })
      .then((res: any) => {
        if (active) {
          setSkillMarketplaceBaseUrl(trim(res?.paramValue));
        }
      })
      .catch(() => {
        if (active) {
          setSkillMarketplaceBaseUrl('');
        }
      })
      .finally(() => {
        if (active) {
          setSkillMarketplaceConfigLoaded(true);
        }
      });

    return () => {
      active = false;
    };
  }, [resourceType]);

  useEffect(() => {
    const handleResourceTypeReload = (
      changedResourceType?:
        | string
        | { resourceType?: string; resetSkillFilters?: boolean; skipResourceCenterRefresh?: boolean }
    ) => {
      if (typeof changedResourceType !== 'string' && changedResourceType?.skipResourceCenterRefresh) {
        return;
      }
      const nextResourceType =
        typeof changedResourceType === 'string' ? changedResourceType : changedResourceType?.resourceType;
      if (nextResourceType !== resourceType) {
        return;
      }
      if (
        resourceType === 'SKILL' &&
        (typeof changedResourceType === 'string' || changedResourceType?.resetSkillFilters !== false)
      ) {
        const nextSearchParams = new URLSearchParams(searchParams);
        nextSearchParams.set('tab', 'personal');
        setCatalogId('');
        setSearchValue('');
        setDebouncedSearchValue('');
        setDropdownParam(getDefaultParams());
        setActiveTab('personal');
        // 中心页内部筛选只更新查询参数，需保留从右侧资源面板带来的返回位置和面板保持状态。
        setSearchParams(nextSearchParams, { state: location.state });
      }
      refreshList();
    };

    EventEmitter.on('beyond-resourceList-resourceType-reload', handleResourceTypeReload);
    return () => {
      EventEmitter.off('beyond-resourceList-resourceType-reload', handleResourceTypeReload);
    };
  }, [EventEmitter, location.state, refreshList, resourceType, searchParams, setSearchParams]);

  // 防抖定时器
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    queryCatalogTree({
      catalogType: '6',
    }).then((res) => {
      const treeData = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
      setCatalogList(normalizeCatalogTree(treeData));
    });

    getDcSystemConfig({ paramCode: 'BYAI_BRAND_VERSION' })
      .then((res: any) => {
        const version = res?.paramValue;
        setBrandVersion(version);
      })
      .catch(() => {
        setBrandVersion('openSource');
      })
      .finally(() => setBrandVersionLoaded(true));

    return () => {
      logoutModuleEvent();
    };
  }, []);

  useEffect(() => {
    if (resourceType !== 'KG_DOC') {
      return;
    }
    queryKnowledgeCapability()
      .then((res: any) => {
        setKnowledgeCapability(res?.data || res || null);
      })
      .catch(() => {
        setKnowledgeCapability({
          knowledgeMode: 'THIRD_PARTY',
          allowKnowledgeBaseCreate: false,
          allowKnowledgeBaseEdit: false,
          allowKnowledgeBaseDelete: false,
          allowKnowledgeImport: true,
        });
      });
  }, [resourceType]);

  useEffect(() => {
    try {
      queryFixedEntryOperationCapability()
        .then((res: any) => {
          setFixedEntryCapability(res || null);
        })
        .catch(() => {
          setFixedEntryCapability(null);
        });
    } catch (error) {
      setFixedEntryCapability(null);
    }
  }, []);

  const canImportCurrentEnterpriseResource = React.useMemo(() => {
    if (activeTab !== 'enterprise') {
      return true;
    }
    if (!fixedEntryCapability) {
      return false;
    }
    if (resourceType === 'KG_DOC') {
      return fixedEntryCapability.canImportEnterpriseKg;
    }
    if (resourceType === 'TOOL') {
      return fixedEntryCapability.canImportEnterpriseToolkit;
    }
    if (resourceType === 'SKILL') {
      return fixedEntryCapability.canImportEnterpriseSkill === true;
    }
    return true;
  }, [activeTab, fixedEntryCapability, resourceType]);

  const handleDetail = useCallback(
    async (item: IResourceItem) => {
      const { resourceBizType, resourceId, resourceSourcePkId } = item;

      if (resourceBizType === 'SKILL') {
        if (resourceId) {
          setDetailPanel?.(
            <SkillDetailDrawer
              resourceId={resourceId}
              title={intl.formatMessage({ id: 'common.skill' })}
              open
              panel
              onClose={() => clearDetailPanel?.()}
            />,
            { width: 350 }
          );
        }
        return;
      }

      if (
        resourceBizType &&
        [
          resourceBizTypeMap.MCP,
          resourceBizTypeMap.TOOL,
          resourceBizTypeMap.TOOLKIT,
          resourceBizTypeMap.AGENT,
        ].includes(resourceBizType)
      ) {
        const titleMap = {
          [resourceBizTypeMap.MCP]: intl.formatMessage({ id: 'common.mcpService' }),
          [resourceBizTypeMap.TOOL]: intl.formatMessage({ id: 'common.tool' }),
          [resourceBizTypeMap.TOOLKIT]: intl.formatMessage({ id: 'common.toolkit' }),
          [resourceBizTypeMap.AGENT]: intl.formatMessage({ id: 'common.agent' }),
        };

        if (resourceId) {
          showSkillDetailDrawer({
            id: resourceId,
            title: titleMap[resourceBizType] || intl.formatMessage({ id: 'common.detail' }),
          });
        }
        return;
      }

      if (
        resourceBizType &&
        [resourceBizTypeMap.KG_DOC, resourceBizTypeMap.KG_QA, resourceBizTypeMap.KG_TERM].includes(resourceBizType)
      ) {
        if (!resourceId) {
          message.error(intl.formatMessage({ id: 'digitalEmployees.noPermission' }));
          return;
        }
        // 列表权限可能缺失或已过期，进入详情后由后端校验实际的使用/管理权限。
        const params = new URLSearchParams();
        if (resourceId) {
          params.set('resourceId', resourceId);
        }
        params.set('resourceBizType', resourceBizType);
        if (resourceSourcePkId) {
          params.set('resourceSourcePkId', resourceSourcePkId);
        }
        params.set('fromTab', item.ownerType || activeTab);
        navigate(`/knowledgeDetail?${params.toString()}`);
        return;
      }

      setDetailPanel?.(
        <ResourceDetail
          visible
          panel
          resourceId={item.resourceId}
          item={item}
          resourceName={resourceName}
          onCancel={() => clearDetailPanel?.()}
          onEdit={() => {}}
        />,
        { width: 350 }
      );
    },
    [activeTab, clearDetailPanel, intl, navigate, resourceName, resourceType, setDetailPanel, showSkillDetailDrawer]
  );

  const handleEditItem = (item: IResourceItem) => {
    setCurrentItem(item);
    if (resourceType === 'KG_DOC') {
      setDetailPanelOpen(true);
    } else {
      setEditModalOpen(true);
    }
  };

  const handleAuth = (item: IResourceItem, type: 'useAuth' | 'mgrAuth') => {
    setSelectRecord(item);
    setAuthType(type);
    setAuthDrawerOpen(true);
  };

  const handleApplyUse = async (item: IResourceItem) => {
    try {
      await applyResourceUse({
        resourceId: item.resourceId,
      });
      message.success(intl.formatMessage({ id: 'resource.applyUseSuccess' }));
      refreshList();
    } catch (error: any) {
      message.error(error);
    }
  };

  const handleAuditUse = (item: IResourceItem) => {
    setSelectRecord(item);
    setUseApplyAuditOpen(true);
  };

  const handleEnterpriseSkillKindChange = (kind: 'skill' | 'group') => {
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.set('tab', 'enterprise');
    nextSearchParams.set('kind', kind);
    setActiveTab('enterprise');
    setCatalogId('');
    setSearchValue('');
    setDebouncedSearchValue('');
    setDropdownParam(getDefaultParams());
    setSearchParams(nextSearchParams, { state: location.state });
  };
  const resourceSearch = (
    <Input
      className={styles.searchInput}
      placeholder={intl.formatMessage({ id: 'common.inputKeyword' })}
      suffix={<SearchOutlined />}
      value={searchValue}
      onChange={(e) => {
        const value = trim(e.target.value);
        setSearchValue(value);
        // 防抖处理，更新 debouncedSearchValue
        if (debounceTimer.current) {
          clearTimeout(debounceTimer.current);
        }
        debounceTimer.current = setTimeout(() => {
          setDebouncedSearchValue(value);
        }, 500);
      }}
      onPressEnter={() => {
        // 立即更新 debouncedSearchValue，触发搜索
        setDebouncedSearchValue(searchValue);
      }}
    />
  );
  const isMyEnterpriseResources = myResourcesOnly && activeTab === 'enterprise';
  const tabBarExtraContent =
    activeTab === 'audit' ? undefined : (
      <Space>
        {myResourcesOnly && activeTab === 'enterprise' && (
          <Segmented
            value={myResourceScope}
            options={[
              { value: 'all', label: intl.formatMessage({ id: 'resourceCenter.myResourcesAll' }) },
              { value: 'created', label: intl.formatMessage({ id: 'resourceCenter.createdByMe' }) },
              { value: 'managed', label: intl.formatMessage({ id: 'resourceCenter.managedByMe' }) },
            ]}
            onChange={(value) => setMyResourceScope(value as MyResourceScope)}
          />
        )}
        {isMyEnterpriseResources && (
          <Segmented
            value={getResourceQueryStatus(activeTab, myResourcesOnly, dropdownParam.resourceStatus)}
            options={myResourceStatusOptions.map((item) => ({
              ...item,
              label: intl.formatMessage({ id: item.label }),
            }))}
            onChange={(resourceStatus) => setDropdownParam((previous) => ({ ...previous, resourceStatus }))}
          />
        )}
        {isEnterpriseSkillGroupMode && isAdminVip(userInfo) && (
          <Select
            aria-label={intl.formatMessage({ id: 'common.status' })}
            value={dropdownParam.resourceStatus}
            style={{ minWidth: 120 }}
            options={statusOptions.map((item) => ({ ...item, label: intl.formatMessage({ id: item.label }) }))}
            onChange={(resourceStatus) => setDropdownParam((previous) => ({ ...previous, resourceStatus }))}
          />
        )}
        {!isEnterpriseSkillGroupMode && !(myResourcesOnly && resourceType === 'SKILL') && (
          <ResourceFilter
            key={`${resourceType}-${activeTab}-${myResourcesOnly}`}
            resourceType={resourceType}
            onOk={(param: any) => {
              setDropdownParam({
                ...param,
                resourceStatus: getResourceQueryStatus(activeTab, myResourcesOnly, param.resourceStatus),
              });
              setCatalogId(param.catalogId || '');
              // 刷新逻辑由ResourceList组件内部处理
            }}
            defaultParam={{
              ...dropdownParam,
              catalogId,
              resourceStatus: getResourceQueryStatus(activeTab, myResourcesOnly, dropdownParam.resourceStatus),
            }}
            catalogOptions={
              myResourcesOnly
                ? undefined
                : [
                    { value: '', label: intl.formatMessage({ id: 'digitalEmployees.skillSquare.allCategory' }) },
                    ...topLevelCatalogList.map((item) => ({
                      value: `${item.catalogId}`,
                      label: getLocalizedCatalogName(item, intl.locale),
                    })),
                  ]
            }
            activeTab={activeTab}
            resourceOwnerFilter={!myResourcesOnly && activeTab === 'personal'}
            // 企业状态已移到外层分段控件，个人页固定查询已上架。
            hideStatusFilter
            alwaysShowStatusFilter={false}
            statusOptionsOverride={myResourcesOnly ? myResourceStatusOptions : undefined}
            hidePermissionFilter={myResourcesOnly}
          />
        )}
        {!myResourcesOnly && resourceSearch}

        {!myResourcesOnly &&
          brandVersion === 'openSource' &&
          resourceType === 'KG_DOC' &&
          (activeTab === 'personal' || isAdmin) && (
          <Tooltip
            title={!knowledgeCapability?.allowKnowledgeBaseCreate ? knowledgeCapabilityDisabledTip : undefined}
          >
            <span>
              <Button
                icon={<PlusOutlined />}
                type="primary"
                disabled={!knowledgeCapability?.allowKnowledgeBaseCreate}
                onClick={() => {
                  if (!knowledgeCapability?.allowKnowledgeBaseCreate) {
                    return;
                  }
                  setCurrentItem(null);
                  setDetailPanelOpen(true);
                }}
              >
                {intl.formatMessage({ id: 'common.create' })}
              </Button>
            </span>
          </Tooltip>
        )}

        {!myResourcesOnly && brandVersion === 'openSource' && (!isEnterpriseSkillGroupMode || isAdminVip(userInfo)) && (
          <Tooltip
            title={
              !canImportCurrentEnterpriseResource
                ? noPermissionDisabledTip
                : intl.formatMessage({ id: 'resource.import.resourceCodeOverwrite' })
            }
          >
            <span>
              <Button
                icon={<UploadOutlined />}
                type="primary"
                disabled={!canImportCurrentEnterpriseResource}
                onClick={() => {
                  if (!canImportCurrentEnterpriseResource) {
                    return;
                  }
                  if (isEnterpriseSkillGroupMode) {
                    setSkillGroupEditing(null);
                    setSkillGroupCreateModalOpen(true);
                  } else {
                    setImportModalOpen(true);
                  }
                }}
              >
                {intl.formatMessage({ id: 'common.import' })}
              </Button>
            </span>
          </Tooltip>
        )}
        {!myResourcesOnly && onMyResourcesOnlyChange && (
          <Badge count={myResourceAuditPendingCount} size="small" offset={[-2, 2]}>
            <Button
              className={styles.installedButton}
              icon={<UnorderedListOutlined />}
              type="default"
              onClick={() => onMyResourcesOnlyChange(true)}
            >
              {intl.formatMessage({
                id:
                  resourceType === 'KG_DOC'
                    ? 'resourceCenter.myKnowledge'
                    : resourceType === 'SKILL'
                      ? 'resourceCenter.mySkills'
                      : resourceType === 'TOOL'
                        ? 'resourceCenter.myTools'
                        : 'resourceCenter.myResources',
              })}
            </Button>
          </Badge>
        )}
      </Space>
    );

  const items: TabsProps['items'] = [
    {
      key: 'personal',
      label: intl.formatMessage({ id: myResourcesOnly ? 'resourceCenter.personal' : 'resource.available' }),
    },
    {
      key: 'enterprise',
      label:
        resourceType === 'SKILL' && !myResourcesOnly ? (
          <Dropdown
            trigger={['hover']}
            open={enterpriseSkillDropdownOpen}
            onOpenChange={setEnterpriseSkillDropdownOpen}
            mouseEnterDelay={0.12}
            mouseLeaveDelay={0.1}
            transitionName="enterprise-skill-dropdown-motion"
            placement="bottomLeft"
            align={{ offset: [0, 5] }}
            overlayClassName={styles.enterpriseSkillDropdown}
            menu={{
              selectedKeys: [enterpriseSkillKind],
              items: [
                {
                  key: 'skill',
                  label: (
                    <span className={styles.enterpriseSkillMenuItem}>
                      {intl.formatMessage({ id: 'resource.skillSingle' })}
                      {enterpriseSkillKind === 'skill' ? (
                        <CheckOutlined className={styles.enterpriseSkillMenuCheck} aria-hidden />
                      ) : null}
                    </span>
                  ),
                },
                {
                  key: 'group',
                  label: (
                    <span className={styles.enterpriseSkillMenuItem}>
                      {intl.formatMessage({ id: 'resource.skillGroup' })}
                      {enterpriseSkillKind === 'group' ? (
                        <CheckOutlined className={styles.enterpriseSkillMenuCheck} aria-hidden />
                      ) : null}
                    </span>
                  ),
                },
              ],
              onClick: ({ key, domEvent }) => {
                domEvent.stopPropagation();
                if (key === 'skill' || key === 'group') {
                  setEnterpriseSkillDropdownOpen(false);
                  handleEnterpriseSkillKindChange(key);
                }
              },
            }}
          >
            <span
              className={classnames(styles.enterpriseSkillTabLabel, {
                [styles.enterpriseSkillTabLabelOpen]: enterpriseSkillDropdownOpen,
              })}
              data-testid="enterprise-skill-tab-trigger"
              tabIndex={0}
              role="button"
              aria-haspopup="menu"
              aria-expanded={enterpriseSkillDropdownOpen}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  event.stopPropagation();
                  setEnterpriseSkillDropdownOpen(true);
                }
              }}
            >
              {intl.formatMessage({
                id: 'resource.official',
              })}
              <DownOutlined
                className={styles.enterpriseSkillTabChevron}
                data-testid="enterprise-skill-dropdown-chevron"
                aria-hidden
              />
            </span>
          </Dropdown>
        ) : (
          intl.formatMessage({ id: myResourcesOnly ? 'resourceCenter.enterprise' : 'resource.official' })
        ),
    },
  ];
  if (myResourcesOnly) {
    items.push({
      key: 'audit',
      label: (
        <Badge count={myResourceAuditPendingCount} size="small" offset={[2, -2]}>
          <span className={styles.auditTabLabel}>{intl.formatMessage({ id: 'resourceCenter.auditCenter' })}</span>
        </Badge>
      ),
    });
  } else if (resourceType === 'SKILL') {
    items.push({
      key: 'marketplace',
      label: (
        <span className={styles.marketplaceTabLabel}>
          {intl.formatMessage({ id: 'resource.skillMarketplace' })}
          <Tooltip title={intl.formatMessage({ id: 'resource.marketplaceFullscreen' })}>
            <button
              type="button"
              className={styles.fullscreenButton}
              aria-label={intl.formatMessage({ id: 'resource.marketplaceFullscreen' })}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                marketplaceRef.current?.requestFullscreen?.();
              }}
            >
              <FullscreenOutlined />
            </button>
          </Tooltip>
        </span>
      ),
    });
  }

  const bannerLabel = React.useMemo(() => {
    if (resourceType === 'KG_DOC') {
      return activeTab === 'personal'
        ? [intl.formatMessage({ id: 'resource.banner.personalKnowledge' }), '个人知识']
        : [intl.formatMessage({ id: 'resource.banner.enterpriseKnowledge' }), '企业知识'];
    }
    if (resourceType === 'TOOL') {
      return activeTab === 'personal'
        ? [intl.formatMessage({ id: 'resource.banner.personalTool' }), '个人工具']
        : [intl.formatMessage({ id: 'resource.banner.enterpriseTool' }), '企业工具'];
    }
    return [];
  }, [activeTab, intl, resourceType]);
  const customBannerUrl = getBannerUrl(bannerList, bannerLabel);
  const bannerUrl = customBannerUrl ? getRuntimeActualUrl(customBannerUrl) : '';

  useEffect(() => {
    getDcSystemConfig({ paramCode: 'BYAI_BANNER' })
      .then((res: any) => {
        setBannerList(parseBannerList(res?.paramValue));
      })
      .catch(() => {
        setBannerList([]);
      })
      .finally(() => {
        setBannerLoaded(true);
      });
  }, []);

  return (
    <div className={classnames(styles.fileManagerContainer, { [styles.myResourcesContainer]: myResourcesOnly })}>
      {myResourcesOnly && (
        <div className={styles.myResourcesBack}>
          <Button
            type="text"
            className={styles.installedBackButton}
            icon={<LeftOutlined />}
            onClick={() => {
              onMyResourcesOnlyChange?.(false);
              const nextSearchParams = new URLSearchParams(searchParams);
              nextSearchParams.delete('tab');
              nextSearchParams.delete('kind');
              setSearchParams(nextSearchParams, { state: location.state });
            }}
          >
            {intl.formatMessage({ id: 'resourceCenter.backToAll' })}
          </Button>
        </div>
      )}
      <CommonTabs
        className={classnames(styles.secondaryTabs, { [styles.myResourcesTabs]: myResourcesOnly })}
        activeKey={activeTab}
        tabBarExtraContent={myResourcesOnly || activeTab === 'marketplace' ? undefined : tabBarExtraContent}
        items={items}
        onChange={(key: string) => {
          const nextTab = key as ResourceTab;
          const nextSearchParams = new URLSearchParams(searchParams);
          nextSearchParams.set('tab', nextTab);
          if (nextTab !== 'enterprise') {
            nextSearchParams.delete('kind');
          }
          setCatalogId('');
          setSearchValue('');
          setDebouncedSearchValue('');
          setDropdownParam(getDefaultParams());
          if (myResourcesOnly) {
            setMyResourceScope('all');
          }
          setActiveTab(nextTab);
          setSearchParams(nextSearchParams, { state: location.state });
        }}
      />
      {/* 与我的数字员工一致：返回、页签、搜索筛选分别占一行。审核页使用自己的工具栏。 */}
      {myResourcesOnly && activeTab !== 'audit' && (
        <div className={styles.myResourcesToolbar}>
          {resourceSearch}
          {tabBarExtraContent}
        </div>
      )}
      {!myResourcesOnly && resourceType === 'SKILL' && activeTab === 'marketplace' ? (
        <div ref={marketplaceRef} className={styles.marketplaceFrameContainer}>
          {!skillMarketplaceConfigLoaded ? (
            <div className={styles.marketplaceFramePlaceholder}>
              <Spin />
            </div>
          ) : skillMarketplaceUrl ? (
            <iframe
              ref={marketplaceIframeRef}
              title={intl.formatMessage({ id: 'resource.skillMarketplace' })}
              className={styles.marketplaceFrame}
              src={skillMarketplaceUrl}
              allow="fullscreen"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className={styles.marketplaceFramePlaceholder}>
              <Empty description={intl.formatMessage({ id: 'resource.skillMarketplaceUrlMissing' })} />
            </div>
          )}
        </div>
      ) : myResourcesOnly && activeTab === 'audit' ? (
        <div className={classnames('full-width ub ub-ver ub-f1', styles.wrapper)}>
          <ResourceAuditCenter
            key={resourceType}
            resourceBizTypeList={auditResourceBizTypeList}
            refreshKey={refreshKey}
            onPendingCountChange={setMyResourceAuditPendingCount}
          />
        </div>
      ) : (
        <div className={classnames('full-width ub ub-ver ub-f1', styles.wrapper)}>
          {!myResourcesOnly && bannerLoaded && bannerUrl && (
            <div className="mb-16">
              <img className={styles.marketBg} src={bannerUrl} alt="poster" />
            </div>
          )}
          {isEnterpriseSkillGroupMode ? (
            <SkillGroupList
              key={refreshKey}
              keyword={debouncedSearchValue}
              activeDigitalEmployeeId={`${activeDigitalEmployeeId || ''}`}
              ownerType="enterprise"
              resourceStatus={
                isAdminVip(userInfo)
                  ? dropdownParam.resourceStatus === ''
                    ? undefined
                    : dropdownParam.resourceStatus
                  : 2
              }
              canDeleteSkillGroup={isAdminVip(userInfo)}
              onEditSkillGroup={(group) => {
                setSkillGroupEditing(group);
                setSkillGroupCreateModalOpen(true);
              }}
            />
          ) : (
            <ResourceList
              key={refreshKey}
              resourceType={resourceType}
              activeTab={activeTab}
              myResourcesOnly={myResourcesOnly}
              myResourceScope={myResourceScope}
              searchValue={debouncedSearchValue}
              catalogId={catalogId}
              dropdownParam={dropdownParam}
              resourceName={resourceName}
              knowledgeCapability={knowledgeCapability}
              knowledgeCapabilityDisabledTip={knowledgeCapabilityDisabledTip}
              onDetail={handleDetail}
              onEdit={handleEditItem}
              onAuth={handleAuth}
              onApplyUse={handleApplyUse}
              onAuditUse={handleAuditUse}
              onRefresh={refreshList}
              enablePublishToEnterprise={brandVersionLoaded && brandVersion !== 'commercial'}
              skillCardViewMode="new"
            />
          )}
        </div>
      )}
      <ResourceImport
        visible={importModalOpen}
        resourceName={resourceName}
        resourceType={resourceType}
        catalogId={catalogId}
        catalogList={catalogList}
        activeTab={activeTab}
        saveTool={saveTool}
        onCancel={() => {
          setImportModalOpen(false);
        }}
        onSuccess={() => {
          setImportModalOpen(false);
          refreshList();
          notifySiderResourceListReload();
        }}
      />
      <SkillGroupCreateModal
        visible={skillGroupCreateModalOpen}
        group={skillGroupEditing}
        onCancel={() => setSkillGroupCreateModalOpen(false)}
        onSuccess={() => {
          setSkillGroupCreateModalOpen(false);
          setSkillGroupEditing(null);
          refreshList();
          notifySiderResourceListReload();
        }}
      />
      <ResourceEdit
        visible={editModalOpen}
        item={currentItem as any}
        resourceType={resourceType}
        catalogList={catalogList}
        onCancel={() => {
          setEditModalOpen(false);
          setCurrentItem(null);
        }}
        onSave={async (values: any) => {
          // 保存编辑逻辑
          console.log('保存编辑:', values);
          try {
            // 调用编辑接口
            await updateResource(values);
            message.success(intl.formatMessage({ id: 'common.saveSuccess' }));
            refreshList();
            notifySiderResourceListReload();
          } catch (error: any) {
            console.error('保存失败:', error);
            // 优先透传后端错误信息（msg / message / 字符串），缺失时再回退到通用文案
            const beMsg = error?.msg || error?.message || (typeof error === 'string' ? error : '');
            message.error(beMsg || intl.formatMessage({ id: 'common.saveFailed' }));
          } finally {
            setEditModalOpen(false);
            setCurrentItem(null);
          }
        }}
      />
      {authDrawerOpen && (
        <AuthListDrawer
          authType={authType}
          record={selectRecord}
          onCancel={() => {
            setAuthDrawerOpen(false);
            setSelectRecord(null);
          }}
          onSuccess={refreshList}
          authApiPath={`/byaiService/auth/privilegeGrant/${
            authType === 'useAuth' ? 'setResourceUsers' : 'setResourceManagers'
          }`}
          headerInfo={{
            title: selectRecord?.resourceName,
            content: selectRecord?.resourceDesc || selectRecord?.description,
            icon: selectRecord?.resourceLogoUrl ? (
              <img
                src={`/byaiService${selectRecord.resourceLogoUrl}`}
                alt={selectRecord.resourceName}
                className={styles.headerIcon}
              />
            ) : (
              <div className={styles.defaultHeaderIcon}>
                <AntdIcon type="icon-chajiantubiao" className={styles.defaultHeaderIconIcon} />
              </div>
            ),
          }}
        />
      )}
      <UseApplyAuditDrawer
        open={useApplyAuditOpen}
        record={selectRecord}
        onCancel={() => {
          setUseApplyAuditOpen(false);
          setSelectRecord(null);
        }}
        onSuccess={() => {
          refreshList();
        }}
      />
      {detailPanelOpen && (
        <DetailPanel
          onCancel={() => {
            setDetailPanelOpen(false);
          }}
          onOk={() => {
            setDetailPanelOpen(false);
            refreshList();
          }}
          ownerType={(currentItem?.ownerType || activeTab) as 'personal' | 'enterprise'}
          mode={currentItem?.resourceId ? 'edit' : 'create'}
          info={currentItem}
          createType={currentItem?.resourceId ? 'import' : 'create'}
          catalogId={catalogId}
          catalogList={catalogList}
        />
      )}
      {skillDetailDrawerHolder}
    </div>
  );
};

export default Resources;
