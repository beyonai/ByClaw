import React, { useCallback, useState, useEffect, useRef } from 'react';
import { UploadOutlined, SearchOutlined, PlusOutlined } from '@ant-design/icons';
import { useIntl, getLocale, useSelector, useNavigate, useSearchParams } from '@umijs/max';
import type { TabsProps } from 'antd';
import { Button, Input, Space, Tooltip, message, Tabs } from 'antd';
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
  type FixedEntryOperationCapability,
} from '@/pages/manager/service/resources';
import { getDcSystemConfig } from '@/pages/manager/service/session';
import ResourceEdit from './components/ResourceEdit';
import ResourceImport from './components/ResourceImport';
import ResourceDetail from './components/ResourceDetail';
import AuthListDrawer from '@/pages/manager/components/AuthListDrawer';
import UseApplyAuditDrawer from '@/pages/manager/components/UseApplyAuditDrawer';
import DetailPanel from '@/pages/knowledgeCenter/components/DetailPanel';
import { useSkillDetailDrawer } from '@/pages/manager/components/SkillDetailDrawer/useSkillDetailDrawer';
import ResourceFilter from './components/ResourceFilter';
import { getDefaultParams } from './components/ResourceFilter';
import ResourceList from './components/ResourceList';
import { saveTool } from '@/pages/manager/service/DigitalEmployeeMgr';
import { resourceBizTypeMap } from '@/constants/knowledge';
import { get, trim, intersection, isEmpty } from 'lodash';
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
  canApplyUse?: boolean;
  canAuditUse?: boolean;
}

interface Props {
  resourceType: string; // 对应资源类型
}

const Resources: React.FC<Props> = ({ resourceType }) => {
  const intl = useIntl();

  // 根据 resourceType 判断资源名称
  const getResourceName = () => {
    if (resourceType === 'KG_DOC') return intl.formatMessage({ id: 'resource.knowledge' });
    if (resourceType === 'TOOL') return intl.formatMessage({ id: 'resource.tool' });
    if (resourceType === 'OBJECT') return intl.formatMessage({ id: 'resource.object' });
    if (resourceType === 'VIEW') return intl.formatMessage({ id: 'resource.view' });
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
  const [resourceDetailOpen, setResourceDetailOpen] = useState(false);
  const [currentItem, setCurrentItem] = useState<IResourceItem | null>(null);
  const [catalogId, setCatalogId] = useState<string>('');
  const [searchValue, setSearchValue] = useState('');
  const [debouncedSearchValue, setDebouncedSearchValue] = useState('');
  const [catalogList, setCatalogList] = useState<
    Array<{ catalogId: string | number; catalogName: string; pcatalogId?: string | number }>
  >([]);

  const defaultTab = (): 'personal' | 'enterprise' => {
    const tabFromUrl = searchParams.get('tab');
    if (tabFromUrl === 'enterprise' || tabFromUrl === 'personal') {
      return tabFromUrl;
    }
    return resourceType === 'VIEW' ? 'enterprise' : 'personal';
  };

  const [activeTab, setActiveTab] = useState<'personal' | 'enterprise'>(defaultTab());

  useEffect(() => {
    const tabFromUrl = searchParams.get('tab');
    if ((tabFromUrl === 'enterprise' || tabFromUrl === 'personal') && tabFromUrl !== activeTab) {
      setActiveTab(tabFromUrl);
    }
  }, [activeTab, searchParams]);

  const { logoutModuleEvent } = useModuleEvent('KNOWLEDGE_CENTER');

  const { userInfo } = useSelector(({ user }: any) => ({
    userInfo: user?.userInfo,
  }));
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

  const topLevelCatalogList = React.useMemo(() => getTopLevelCatalogs(catalogList), [catalogList]);
  const refreshList = useCallback(() => {
    setRefreshKey((prevKey) => prevKey + 1);
  }, []);

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
    return true;
  }, [activeTab, fixedEntryCapability, resourceType]);

  const handleDetail = useCallback(
    (item: IResourceItem) => {
      const { resourceBizType, resourceId, resourceSourcePkId } = item;

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

      setCurrentItem(item);
      setResourceDetailOpen(true);
    },
    [activeTab, intl, navigate, showSkillDetailDrawer]
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

  const tabBarExtraContent = (
    <Space>
      <ResourceFilter
        resourceType={resourceType}
        onOk={(param: any) => {
          setDropdownParam(param);
          // 刷新逻辑由ResourceList组件内部处理
        }}
        defaultParam={dropdownParam}
        activeTab={activeTab}
      />
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

      {brandVersion === 'openSource' && (
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
    ...(resourceType !== 'VIEW'
      ? [
        {
          key: 'personal',
          label: `${intl.formatMessage({ id: 'resource.personal' })}${resourceName}`,
        },
      ]
      : []),
    {
      key: 'enterprise',
      label: `${intl.formatMessage({ id: 'resource.enterprise' })}${resourceName}`,
    },
  ];

  const local = getLocale();
  const isEN = React.useMemo(() => {
    return local.includes('en');
  }, [local]);

  return (
    <div className={styles.fileManagerContainer}>
      <CommonTabs
        activeKey={activeTab}
        tabBarExtraContent={tabBarExtraContent}
        items={items}
        onChange={(key: string) => {
          const nextTab = key as 'personal' | 'enterprise';
          const nextSearchParams = new URLSearchParams(searchParams);
          nextSearchParams.set('tab', nextTab);
          setCatalogId('');
          setSearchValue('');
          setDebouncedSearchValue('');
          setDropdownParam(getDefaultParams());
          setActiveTab(nextTab);
          setSearchParams(nextSearchParams);
        }}
      />
      <div className={classnames('full-width ub ub-ver ub-f1', styles.wrapper)}>
        <div className="mb-16">
          <img
            className={styles.marketBg}
            src={getRuntimeActualUrl(isEN ? '/beyond/market-en.png' : '/beyond/market.png')}
            alt="poster"
          />
        </div>
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
              // 重置搜索值
              setSearchValue('');
              setDebouncedSearchValue('');
              // 刷新逻辑由ResourceList组件内部处理
            }}
          />
        </div>
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
        />
      </div>
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
      {resourceDetailOpen && (
        <ResourceDetail
          visible={resourceDetailOpen}
          resourceId={currentItem?.resourceId}
          item={currentItem}
          resourceType={resourceType}
          resourceName={resourceName}
          onCancel={() => {
            setResourceDetailOpen(false);
            setCurrentItem(null);
          }}
          onEdit={() => {}}
        />
      )}
      {skillDetailDrawerHolder}
    </div>
  );
};

export default Resources;
