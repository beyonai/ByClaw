// @ts-nocheck
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Empty, Input, Modal, Spin, Table, Tabs, Tag, message } from 'antd';
import { LinkOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useIntl, useNavigate } from '@umijs/max';
import classnames from 'classnames';
import AntdIcon from '@/components/AntdIcon';
import CommonTabs from '@/components/CommonTabs';
import ResourceCard from '@/components/Resources/components/ResourceCard';
import ResourceFilter, { getDefaultParams } from '@/components/Resources/components/ResourceFilter';
import { buildResourceListFilterParam } from '@/components/Resources/utils';
import AuthListDrawer from '@/pages/manager/components/AuthListDrawer';
import UseApplyAuditDrawer from '@/pages/manager/components/UseApplyAuditDrawer';
import { applyResourceUse, listResourceUseAuth } from '@/pages/manager/service/resources';
import { queryCatalogTree } from '@/service/digitalEmployees';
import { getTopLevelCatalogs, normalizeCatalogTree } from '@/utils/catalog';
import { refreshOntologyBases } from '@/service/ontology';
import { checkEnterpriseAdminPermission } from '@/service/auth';
import RegisterOntologyModal from './RegisterOntologyModal';
import BindOntologyDrawer from './BindOntologyDrawer';
import styles from './index.module.less';

const ONTOLOGY_BASE_BIZ_TYPE = 'ONTOLOGY_BASE';

// 本体库编码：后端存扩展表 ss_res_ext_ontology.pid（随 ss_resource 列表 join 下发为 pid）；
// 本体库行的 resourceCode 即 baseId，保留多重兜底。
const getBaseId = (row: any) => row?.pid || row?.ontologyBaseCode || row?.resourceCode || row?.baseId;

const OntologyCenter: React.FC = () => {
  const intl = useIntl();
  const navigate = useNavigate();

  // 卡片点击 → 跳转本体库管理页（携带展示信息，避免详情页再查一次）
  const openBaseDetail = (row: any) => {
    const query = new URLSearchParams({
      baseId: `${getBaseId(row) || ''}`,
      ownerType: `${row?.ownerType || ''}`,
      resourceId: `${row?.resourceId || ''}`,
      resourceName: `${row?.resourceName || row?.displayName || ''}`,
      resourceCode: `${row?.resourceCode || getBaseId(row) || ''}`,
    });
    navigate(`/ontologyBaseDetail?${query.toString()}`);
  };

  const [activeTab, setActiveTab] = useState<'personal' | 'enterprise'>('personal');
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [catalogId, setCatalogId] = useState('');
  const [catalogList, setCatalogList] = useState<any[]>([]);
  const [dropdownParam, setDropdownParam] = useState<any>(getDefaultParams());
  const [registerOpen, setRegisterOpen] = useState(false);
  const [bindBase, setBindBase] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);
  // 刷新本体仅管理员（平台/业务/组织）+ 超管可操作
  const [canRefresh, setCanRefresh] = useState(false);
  const [refreshResult, setRefreshResult] = useState<any>(null);
  // 刷新防频繁：两次点击最小间隔
  const lastRefreshAtRef = useRef(0);
  const REFRESH_MIN_INTERVAL = 5000;

  const topLevelCatalogList = useMemo(() => getTopLevelCatalogs(catalogList), [catalogList]);

  useEffect(() => {
    queryCatalogTree({ catalogType: '6' }).then((res: any) => {
      const treeData = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
      setCatalogList(normalizeCatalogTree(treeData));
    });
    // 企业本体「刷新本体」权限：平台/业务/组织管理员 + 超管
    checkEnterpriseAdminPermission()
      .then((res: any) => setCanRefresh(!!(res?.data ?? res)))
      .catch(() => setCanRefresh(false));
  }, []);

  // 授权 / 使用申请审核 抽屉（复用资源中心同款组件）
  const [authDrawerOpen, setAuthDrawerOpen] = useState(false);
  const [authType, setAuthType] = useState<'useAuth' | 'mgrAuth'>('useAuth');
  const [useApplyAuditOpen, setUseApplyAuditOpen] = useState(false);
  const [selectRecord, setSelectRecord] = useState<any>(null);

  const loadList = useCallback(
    async (kw = keyword) => {
      setLoading(true);
      try {
        const requestFilterParam = buildResourceListFilterParam(activeTab, dropdownParam);
        const res: any = await listResourceUseAuth({
          keyword: `${kw || ''}`.trim(),
          pageNum: 1,
          pageSize: 200,
          ownerType: activeTab,
          catalogId: catalogId || undefined,
          ...requestFilterParam,
          // 本体中心固定只查本体资源，忽略筛选器可能带出的其它业务类型。
          resourceBizTypeList: [ONTOLOGY_BASE_BIZ_TYPE],
        });
        const pageData = res?.data || res || {};
        setList(pageData?.list || pageData?.rows || []);
      } catch {
        setList([]);
      } finally {
        setLoading(false);
      }
    },
    [activeTab, keyword, catalogId, dropdownParam]
  );

  useEffect(() => {
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, catalogId, dropdownParam]);

  const handleAuth = (item: any, type: 'useAuth' | 'mgrAuth') => {
    setSelectRecord(item);
    setAuthType(type);
    setAuthDrawerOpen(true);
  };

  const handleApplyUse = async (item: any) => {
    try {
      await applyResourceUse({ resourceId: item.resourceId });
      message.success(intl.formatMessage({ id: 'resource.applyUseSuccess' }));
      loadList();
    } catch (error: any) {
      message.error(error);
    }
  };

  const handleAuditUse = (item: any) => {
    setSelectRecord(item);
    setUseApplyAuditOpen(true);
  };

  const handleRefresh = async () => {
    if (refreshing) return;
    const now = Date.now();
    if (now - lastRefreshAtRef.current < REFRESH_MIN_INTERVAL) {
      message.warning(intl.formatMessage({ id: 'ontologyCenter.refresh.tooFrequent' }));
      return;
    }
    lastRefreshAtRef.current = now;
    setRefreshing(true);
    try {
      const res: any = await refreshOntologyBases({ ownerType: 'enterprise' });
      if (res && res.code !== undefined && res.code !== 0 && res.code !== 200) {
        message.error(res.msg || res.message || intl.formatMessage({ id: 'common.operationFailed' }));
        return;
      }
      const data = res?.data ?? res ?? {};
      setRefreshResult(data);
      loadList();
    } catch (e: any) {
      const errMsg = typeof e === 'string' ? e : e?.message || intl.formatMessage({ id: 'common.operationFailed' });
      message.error(errMsg);
    } finally {
      setRefreshing(false);
    }
  };

  const renderCards = () => {
    if (!loading && !list.length) {
      return (
        <div className={styles.emptyWrap}>
          <Empty />
        </div>
      );
    }
    return (
      <div className={styles.cardGrid}>
        {list.map((item) => {
          const cardItem = {
            ...item,
            // 本体的编辑/注销在远程本体管理门户完成，百应侧只做浏览、授权和安装绑定。
            canEdit: false,
            canDelete: false,
          };
          return (
            <ResourceCard
              key={item.resourceId}
              resource={cardItem}
              resourceType={ONTOLOGY_BASE_BIZ_TYPE}
              onCardClick={() => openBaseDetail({ ...cardItem, ownerType: cardItem.ownerType || activeTab })}
              actionConfig={{
                scene: activeTab,
                hiddenMenuItemKeys: ['edit', 'delete'],
                onAuth: (type) => handleAuth(cardItem, type),
                onApplyUse: () => handleApplyUse(cardItem),
                onAuditUse: () => handleAuditUse(cardItem),
                extraMenuItems: [
                  {
                    key: 'bind-ontology',
                    visible: (currentResource: any) =>
                      Boolean(currentResource?.hasUsePermission || currentResource?.hasManagePermission),
                    label: (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <LinkOutlined />
                        {intl.formatMessage({ id: 'ontologyCenter.bind.entry' })}
                      </span>
                    ),
                    onClick: ({ domEvent }: any) => {
                      domEvent?.stopPropagation?.();
                      setBindBase({
                        ...cardItem,
                        ownerType: cardItem.ownerType || activeTab,
                        baseId: getBaseId(cardItem),
                      });
                    },
                  },
                ],
              }}
            />
          );
        })}
      </div>
    );
  };

  return (
    <div className={styles.container}>
      <CommonTabs
        activeKey={activeTab}
        onChange={(key) => {
          setActiveTab(key as 'personal' | 'enterprise');
          setCatalogId('');
          setKeyword('');
          setDropdownParam(getDefaultParams());
        }}
        tabBarExtraContent={
          <div className={styles.toolbar}>
            <ResourceFilter
              resourceType={ONTOLOGY_BASE_BIZ_TYPE}
              activeTab={activeTab}
              defaultParam={dropdownParam}
              onOk={(param: any) => setDropdownParam(param)}
            />
            <Input
              className={styles.searchInput}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onPressEnter={() => loadList()}
              suffix={<SearchOutlined onClick={() => loadList()} />}
              placeholder={intl.formatMessage({ id: 'common.inputKeyword' })}
            />
            {activeTab === 'personal' ? (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setRegisterOpen(true)}>
                {intl.formatMessage({ id: 'ontologyCenter.register.title' })}
              </Button>
            ) : canRefresh ? (
              <Button type="primary" icon={<ReloadOutlined />} loading={refreshing} onClick={handleRefresh}>
                {intl.formatMessage({ id: 'ontologyCenter.refresh.title' })}
              </Button>
            ) : null}
          </div>
        }
        items={[
          { key: 'personal', label: intl.formatMessage({ id: 'ontologyCenter.tab.personal' }) },
          { key: 'enterprise', label: intl.formatMessage({ id: 'ontologyCenter.tab.enterprise' }) },
        ]}
      />

      <div className={styles.wrapper}>
        <div className={classnames('ub ub-ac gap8', styles.filterBar)}>
          <Tabs
            className={classnames('ub-f1', styles.tabs)}
            activeKey={catalogId}
            items={[
              { label: intl.formatMessage({ id: 'digitalEmployees.skillSquare.allCategory' }), key: '' },
              ...topLevelCatalogList.map((cat: any) => ({ label: cat.catalogName, key: `${cat?.catalogId}` })),
            ]}
            onChange={(key) => {
              setCatalogId(`${key}`);
              setKeyword('');
            }}
          />
        </div>
        <Spin spinning={loading}>{renderCards()}</Spin>
      </div>

      <RegisterOntologyModal
        open={registerOpen}
        ownerType={activeTab}
        catalogList={catalogList}
        onCancel={() => setRegisterOpen(false)}
        onSuccess={() => {
          setRegisterOpen(false);
          loadList();
        }}
      />
      <BindOntologyDrawer open={!!bindBase} base={bindBase} onClose={() => setBindBase(null)} />

      {authDrawerOpen && (
        <AuthListDrawer
          authType={authType}
          record={selectRecord}
          onCancel={() => {
            setAuthDrawerOpen(false);
            setSelectRecord(null);
          }}
          onSuccess={loadList}
          authApiPath={`/byaiService/auth/privilegeGrant/${
            authType === 'useAuth' ? 'setResourceUsers' : 'setResourceManagers'
          }`}
          headerInfo={{
            title: selectRecord?.resourceName,
            content: selectRecord?.resourceDesc || selectRecord?.description,
            icon: (
              <div className={styles.authHeaderIcon}>
                <AntdIcon type="icon-a-Boxhezioutline" />
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
        onSuccess={loadList}
      />

      <Modal
        open={!!refreshResult}
        title={intl.formatMessage({ id: 'ontologyCenter.refresh.resultTitle' })}
        footer={null}
        width={640}
        onCancel={() => setRefreshResult(null)}
      >
        {refreshResult && (
          <>
            <div className={styles.refreshSummary}>
              {intl.formatMessage(
                { id: 'ontologyCenter.refresh.summary' },
                {
                  total: refreshResult.total || 0,
                  added: refreshResult.added || 0,
                  updated: refreshResult.updated || 0,
                  offline: refreshResult.offline || 0,
                }
              )}
            </div>
            <Table
              size="small"
              rowKey={(r: any) => `${r.action}-${r.baseCode}`}
              dataSource={refreshResult.details || []}
              pagination={false}
              scroll={{ y: 320 }}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
              columns={[
                {
                  title: intl.formatMessage({ id: 'ontologyCenter.refresh.col.action' }),
                  dataIndex: 'action',
                  width: 90,
                  render: (action: string) => {
                    const map: Record<string, { color: string; id: string }> = {
                      insert: { color: 'green', id: 'ontologyCenter.refresh.action.insert' },
                      update: { color: 'blue', id: 'ontologyCenter.refresh.action.update' },
                      offline: { color: 'red', id: 'ontologyCenter.refresh.action.offline' },
                    };
                    const conf = map[action] || { color: 'default', id: '' };
                    return <Tag color={conf.color}>{conf.id ? intl.formatMessage({ id: conf.id }) : action}</Tag>;
                  },
                },
                {
                  title: intl.formatMessage({ id: 'ontologyCenter.refresh.col.baseCode' }),
                  dataIndex: 'baseCode',
                  ellipsis: true,
                },
                {
                  title: intl.formatMessage({ id: 'ontologyCenter.refresh.col.baseName' }),
                  dataIndex: 'baseName',
                  ellipsis: true,
                },
              ]}
            />
          </>
        )}
      </Modal>
    </div>
  );
};

export default OntologyCenter;
