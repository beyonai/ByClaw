import React, { useCallback, useContext, useState, useEffect, useRef } from 'react';
import { UploadOutlined, SearchOutlined, PlusOutlined, FullscreenOutlined } from '@ant-design/icons';
import { useIntl, useSelector, useNavigate, useSearchParams } from '@umijs/max';
import type { TabsProps } from 'antd';
import { Button, Dropdown, Empty, Input, Space, Spin, Tooltip, message, Tabs } from 'antd';
import classnames from 'classnames';
import AntdIcon from '@/components/AntdIcon';
import useModuleEvent from '@/hooks/useModuleEvent';
import CommonTabs from '@/components/CommonTabs';
import { getRuntimeActualUrl } from '@/utils';
import { getTopLevelCatalogs, normalizeCatalogTree } from '@/utils/catalog';
import { queryCatalogTree, updateResource } from '@/service/digitalEmployees';
import { queryKnowledgeCapability, type KnowledgeCapability } from '@/service/knowledgeCenter';
import {
  applyResourceUse,
  queryFixedEntryOperationCapability,
  queryResourceOperationPermissions,
  type FixedEntryOperationCapability,
} from '@/pages/manager/service/resources';
import { getDcSystemConfig } from '@/pages/manager/service/session';
import ResourceEdit from './components/ResourceEdit';
import ResourceImport from './components/ResourceImport';
import ResourceDetail from './components/ResourceDetail';
import AuthListDrawer from '@/pages/manager/components/AuthListDrawer';
import UseApplyAuditDrawer from '@/pages/manager/components/UseApplyAuditDrawer';
import DetailPanel from '@/pages/knowledgeCenter/components/DetailPanel';
import SkillDetailDrawer from '@/pages/manager/components/SkillDetailDrawer/SkillDetailDrawer';
import { useSkillDetailDrawer } from '@/pages/manager/components/SkillDetailDrawer/useSkillDetailDrawer';
import ResourceFilter from './components/ResourceFilter';
import { getDefaultParams } from './components/ResourceFilter';
import ResourceList from './components/ResourceList';
import SkillGroupList from './components/SkillGroupList';
import { saveTool } from '@/pages/manager/service/DigitalEmployeeMgr';
import { resourceBizTypeMap } from '@/constants/knowledge';
import { SiderContentContext } from '@/layout/sider/siderContentContext';
import useGlobal from '@/hooks/useGlobal';
import { getToken } from '@/utils/auth';
import { get, trim, intersection, isEmpty } from 'lodash';
import { buildSkillMarketplaceUrl, isSkillMarketplaceInstalledMessage } from './utils';
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
  canAuditUse?: boolean;
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
}

interface Props {
  resourceType: string; // 对应资源类型
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

const Resources: React.FC<Props> = ({ resourceType }) => {
  const intl = useIntl();
  const { EventEmitter, agentId, agentInfo } = useGlobal();

  // 根据 resourceType 判断资源名称
  const getResourceName = () => {
    if (resourceType === 'KG_DOC') return intl.formatMessage({ id: 'resource.knowledge' });
    if (resourceType === 'TOOL') return intl.formatMessage({ id: 'common.tool' });
    if (resourceType === 'OBJECT') return intl.formatMessage({ id: 'common.object' });
    if (resourceType === 'VIEW') return intl.formatMessage({ id: 'common.viewName' });
    if (resourceType === 'SKILL') return intl.formatMessage({ id: 'common.skill' });
    return intl.formatMessage({ id: 'resource.default' }); // 默认值
  };
  const resourceName = getResourceName();
  const knowledgeCapabilityDisabledTip = intl.formatMessage({ id: 'resource.thirdPartyKnowledgeBaseMode' });
  const noPermissionDisabledTip = intl.formatMessage({ id: 'common.noPermissionOperation' });
  const navigate = useNavigate();
  const { placeholder: skillDetailDrawerHolder, show: showSkillDetailDrawer } = useSkillDetailDrawer();
  const [searchParams, setSearchParams] = useSearchParams();

  const [importModalOpen, setImportModalOpen] = useState(false);
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

  type ResourceTab = 'personal' | 'enterprise' | 'marketplace';
  const defaultTab = (): ResourceTab => {
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
  const enterpriseSkillKind = searchParams.get('kind') === 'group' ? 'group' : 'skill';
  const isEnterpriseSkillGroupMode =
    resourceType === 'SKILL' && activeTab === 'enterprise' && enterpriseSkillKind === 'group';
  const marketplaceRef = useRef<HTMLDivElement>(null);
  const marketplaceIframeRef = useRef<HTMLIFrameElement>(null);
  const [skillMarketplaceBaseUrl, setSkillMarketplaceBaseUrl] = useState('');
  const [skillMarketplaceConfigLoaded, setSkillMarketplaceConfigLoaded] = useState(resourceType !== 'SKILL');
  const { setDetailPanel, clearDetailPanel } = useContext(SiderContentContext);

  useEffect(() => {
    const tabFromUrl = searchParams.get('tab');
    if (
      (tabFromUrl === 'enterprise' ||
        tabFromUrl === 'personal' ||
        (resourceType === 'SKILL' && tabFromUrl === 'marketplace')) &&
      tabFromUrl !== activeTab
    ) {
      setActiveTab(tabFromUrl);
    }
  }, [activeTab, searchParams]);

  const { logoutModuleEvent } = useModuleEvent('KNOWLEDGE_CENTER');

  const { userInfo, defaultDigEmployeeId } = useSelector(({ user, employees }: any) => ({
    userInfo: user?.userInfo,
    defaultDigEmployeeId: employees?.defaultDigEmployeeId,
  }));
  const activeDigitalEmployeeId =
    agentId || agentInfo?.agentId || defaultDigEmployeeId || userInfo?.defaultDigEmployeeId;
  const portalOrigin = typeof window === 'undefined' ? undefined : window.location.origin;
  const beyondToken = getToken();
  const skillMarketplaceUrl = React.useMemo(
    () => buildSkillMarketplaceUrl(skillMarketplaceBaseUrl, activeDigitalEmployeeId, beyondToken, portalOrigin),
    [activeDigitalEmployeeId, beyondToken, portalOrigin, skillMarketplaceBaseUrl]
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
  const [bannerList, setBannerList] = useState<any[]>([]);
  const [bannerLoaded, setBannerLoaded] = useState(false);

  const topLevelCatalogList = React.useMemo(() => getTopLevelCatalogs(catalogList), [catalogList]);
  const refreshList = useCallback(() => {
    setRefreshKey((prevKey) => prevKey + 1);
  }, []);

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
      if (!isSkillMarketplaceInstalledMessage(event.data, activeDigitalEmployeeId)) {
        return;
      }
      notifySiderResourceListReload();
    };

    window.addEventListener('message', handleSkillMarketplaceMessage);
    return () => {
      window.removeEventListener('message', handleSkillMarketplaceMessage);
    };
  }, [activeDigitalEmployeeId, notifySiderResourceListReload, resourceType, skillMarketplaceUrl]);

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
        setSearchParams(nextSearchParams);
      }
      refreshList();
    };

    EventEmitter.on('beyond-resourceList-resourceType-reload', handleResourceTypeReload);
    return () => {
      EventEmitter.off('beyond-resourceList-resourceType-reload', handleResourceTypeReload);
    };
  }, [EventEmitter, refreshList, resourceType, searchParams, setSearchParams]);

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
      });

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
    if (resourceType === 'VIEW') {
      return fixedEntryCapability.canImportEnterpriseView;
    }
    if (resourceType === 'OBJECT') {
      return fixedEntryCapability.canImportEnterpriseObject;
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
        try {
          const res: any = await queryResourceOperationPermissions({ resourceId });
          const permissions = res?.data || res || {};
          const canViewDetail =
            permissions?.canViewDetail ??
            permissions?.hasManagePermission ??
            permissions?.hasUsePermission ??
            permissions?.canEdit ??
            permissions?.canManageAuth ??
            permissions?.canDelete ??
            false;
          if (!canViewDetail) {
            message.error(intl.formatMessage({ id: 'digitalEmployees.noPermission' }));
            return;
          }
        } catch (error: any) {
          message.error(error?.msg || error?.message || intl.formatMessage({ id: 'digitalEmployees.noPermission' }));
          return;
        }
        const params = new URLSearchParams();
        if (resourceId) {
          params.set('resourceId', resourceId);
        }
        params.set('resourceBizType', resourceBizType);
        if (resourceSourcePkId) {
          params.set('resourceSourcePkId', resourceSourcePkId);
        }
        params.set('fromTab', activeTab);
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
    setSearchParams(nextSearchParams);
  };
  const tabBarExtraContent = (
    <Space>
      {!isEnterpriseSkillGroupMode && (
        <ResourceFilter
          resourceType={resourceType}
          onOk={(param: any) => {
            setDropdownParam(param);
            // 刷新逻辑由ResourceList组件内部处理
          }}
          defaultParam={dropdownParam}
          activeTab={activeTab}
        />
      )}
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

      {brandVersion === 'openSource' && resourceType === 'KG_DOC' && (activeTab === 'personal' || isAdmin) && (
        <Tooltip title={!knowledgeCapability?.allowKnowledgeBaseCreate ? knowledgeCapabilityDisabledTip : undefined}>
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

      {!isEnterpriseSkillGroupMode && brandVersion === 'openSource' && (
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
                setImportModalOpen(true);
              }}
            >
              {intl.formatMessage({ id: 'common.import' })}
            </Button>
          </span>
        </Tooltip>
      )}
    </Space>
  );

  const items: TabsProps['items'] = [
    {
      key: 'personal',
      label: `${intl.formatMessage({ id: 'resource.personal' })}${resourceName}`,
    },
    {
      key: 'enterprise',
      label:
        resourceType === 'SKILL' ? (
          <Dropdown
            trigger={['hover', 'click']}
            open={enterpriseSkillDropdownOpen}
            onOpenChange={setEnterpriseSkillDropdownOpen}
            menu={{
              items: [
                {
                  key: 'skill',
                  label: (
                    <span aria-checked={enterpriseSkillKind === 'skill'} role="menuitemradio">
                      {intl.formatMessage({ id: 'resource.skillSingle' })}
                    </span>
                  ),
                },
                {
                  key: 'group',
                  label: (
                    <span aria-checked={enterpriseSkillKind === 'group'} role="menuitemradio">
                      {intl.formatMessage({ id: 'resource.skillGroup' })}
                    </span>
                  ),
                },
              ],
              onClick: ({ key }: { key: string }) => {
                if (key === 'skill' || key === 'group') {
                  setEnterpriseSkillDropdownOpen(false);
                  handleEnterpriseSkillKindChange(key);
                }
              },
            }}
          >
            <span
              className={styles.enterpriseSkillTabLabel}
              tabIndex={0}
              role="button"
              onFocus={() => setEnterpriseSkillDropdownOpen(true)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setEnterpriseSkillDropdownOpen(true);
                }
              }}
            >
              {intl.formatMessage({
                id:
                  enterpriseSkillKind === 'group' ? 'resource.enterpriseSkillGroup' : 'resource.enterpriseSkillSingle',
              })}
            </span>
          </Dropdown>
        ) : (
          `${intl.formatMessage({ id: 'resource.enterprise' })}${resourceName}`
        ),
    },
  ];
  if (resourceType === 'SKILL') {
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
    if (resourceType === 'VIEW') {
      return activeTab === 'personal'
        ? [intl.formatMessage({ id: 'resource.banner.personalView' }), '个人视图']
        : [intl.formatMessage({ id: 'resource.banner.enterpriseView' }), '企业视图'];
    }
    if (resourceType === 'OBJECT') {
      return activeTab === 'personal'
        ? [intl.formatMessage({ id: 'resource.banner.personalObject' }), '个人对象']
        : [intl.formatMessage({ id: 'resource.banner.enterpriseObject' }), '企业对象'];
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
    <div className={styles.fileManagerContainer}>
      <CommonTabs
        activeKey={activeTab}
        tabBarExtraContent={activeTab === 'marketplace' ? undefined : tabBarExtraContent}
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
          setActiveTab(nextTab);
          setSearchParams(nextSearchParams);
        }}
      />
      {resourceType === 'SKILL' && activeTab === 'marketplace' ? (
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
      ) : (
        <div className={classnames('full-width ub ub-ver ub-f1', styles.wrapper)}>
          {bannerLoaded && bannerUrl && (
            <div className="mb-16">
              <img className={styles.marketBg} src={bannerUrl} alt="poster" />
            </div>
          )}
          {!isEnterpriseSkillGroupMode && (
            <div className={classnames('ub ub-ac gap8', styles.filterBar)}>
              <Tabs
                className={classnames('ub-f1', styles.tabs)}
                activeKey={catalogId}
                items={[
                  { label: intl.formatMessage({ id: 'digitalEmployees.skillSquare.allCategory' }), key: '' },
                  ...topLevelCatalogList.map((item) => ({
                    label: item.catalogName,
                    key: `${item?.catalogId}`,
                  })),
                ]}
                onChange={(activeKey) => {
                  setCatalogId(`${activeKey}`);
                  setSearchValue('');
                  setDebouncedSearchValue('');
                }}
              />
            </div>
          )}
          {isEnterpriseSkillGroupMode ? (
            <SkillGroupList
              key={refreshKey}
              keyword={debouncedSearchValue}
              activeDigitalEmployeeId={`${activeDigitalEmployeeId || ''}`}
              ownerType="enterprise"
              resourceStatus={2}
            />
          ) : (
            <ResourceList
              key={refreshKey}
              resourceType={resourceType}
              activeTab={activeTab}
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
          ownerType={activeTab as 'personal' | 'enterprise'}
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
