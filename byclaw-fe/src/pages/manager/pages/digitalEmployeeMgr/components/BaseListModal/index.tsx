// @ts-nocheck
/* eslint-disable function-paren-newline */
/* eslint-disable no-nested-ternary */
import { Input, Spin, Empty, Tree, Tabs, Select } from 'antd';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector, useIntl } from '@umijs/max';
import classnames from 'classnames';
import AntdIcon from '@/pages/manager/components/AntdIcon';
import Pagination from '@/pages/manager/components/Pagination';
import styles from './index.module.less';
import ModalDrawer from '@/pages/manager/components/ModalDrawer';
import ItemCard from './ItemCard';
import ItemCard2 from './ItemCard2';
import { listResourceUseAuth } from '@/pages/manager/service/resources';
import { getDcSystemConfigListByStandType } from '@/service/auth';
import { getDcSystemConfig } from '@/pages/manager/service/session';
import { DEFAULT_MENU_CONFIG, getVisibleMenuKeysFromConfig } from '@/constants/system';

const EXTERNAL_TOOLS_TAB = 'EXTERNAL';
const BUILTIN_TOOLS_TAB = 'BUILTIN';

const { DirectoryTree } = Tree;
const defaultVisibleMenuKeys = getVisibleMenuKeysFromConfig(DEFAULT_MENU_CONFIG);
const menuKeyByTabKey = {
  VIEW: 'view',
  OBJECT: 'object',
};

function BaseListModal(props) {
  const {
    open,
    onCancel,
    digitalType = '006',
    appId,
    reload,
    handleSelect,
    skills,
    knowledgeBases,
    handleRemove,
    handleUpdateItem,
    enableTabs,
    agentType,
  } = props;
  const intl = useIntl();

  const dispatch = useDispatch();

  const [sourceLoading, setSourceLoading] = useState(false);
  const { catalogLoading = false } = useSelector(({ loading }) => ({
    catalogLoading: !!loading.effects['employeeMgr/getCatalogOnResource'],
  }));

  // 知识库
  const isDataset = digitalType === '006';

  // 工具
  const isPlugin = digitalType === '005';

  const isAskNumber = agentType === '005';

  const [searchName, setSearchName] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [catalogId, setCatalogId] = useState(['']);
  const [catalogList, setCatalogList] = useState([]);
  const [visibleMenuKeys, setVisibleMenuKeys] = useState(defaultVisibleMenuKeys);
  const [bundledTools, setBundledTools] = useState([]);
  const [bundledToolLoading, setBundledToolLoading] = useState(false);
  const [toolSubTab, setToolSubTab] = useState(EXTERNAL_TOOLS_TAB);

  useEffect(() => {
    getDcSystemConfigListByStandType({
      standType: 'MENU_ICON_SHOW_TAB',
    })
      .then((res) => {
        const configData = res?.data || res;
        if (Array.isArray(configData) && configData.length > 0) {
          setVisibleMenuKeys(getVisibleMenuKeysFromConfig(configData));
        }
      })
      .catch(() => {});
  }, []);

  const filteredCatalogList = useMemo(() => {
    const keyword = (searchName || '').trim().toLowerCase();
    if (!keyword) return catalogList;

    const filterTree = (nodes = []) =>
      nodes.reduce((acc, node) => {
        const title = `${node?.catalogName || ''}`.toLowerCase();
        const children = Array.isArray(node?.children) ? node.children : [];
        const matchedChildren = filterTree(children);
        const isMatched = title.includes(keyword);

        if (isMatched || matchedChildren.length) {
          acc.push({
            ...node,
            children: matchedChildren,
          });
        }

        return acc;
      }, []);

    return filterTree(catalogList);
  }, [catalogList, searchName]);

  const tabs = useMemo(() => {
    if (isDataset) {
      return [
        {
          key: 'KG_DOC',
          label: intl.formatMessage({
            id: 'baseListModal.tabs.document',
          }),
        },
        {
          key: 'KG_QA',
          label: intl.formatMessage({
            id: 'baseListModal.tabs.qa',
          }),
        },
      ];
    }
    if (isAskNumber) {
      return [
        {
          key: 'VIEW',
          label: intl.formatMessage({
            id: 'baseListModal.tabs.view',
          }),
        },
        {
          key: 'OBJECT',
          label: intl.formatMessage({
            id: 'baseListModal.tabs.object',
          }),
        },
      ];
    }
    return [
      {
        key: 'TOOLKIT',
        label: intl.formatMessage({
          id: 'baseListModal.tabs.toolSet',
        }),
      },
      {
        key: 'AGENT',
        label: intl.formatMessage({
          id: 'baseListModal.tabs.agent',
        }),
      },
      {
        key: 'MCP',
        label: intl.formatMessage({
          id: 'baseListModal.tabs.mcp',
        }),
      },
      {
        key: 'VIEW',
        label: intl.formatMessage({
          id: 'baseListModal.tabs.view',
        }),
      },
      {
        key: 'OBJECT',
        label: intl.formatMessage({
          id: 'baseListModal.tabs.object',
        }),
      },
    ];
  }, [isAskNumber, intl]);

  const displayTabs = useMemo(() => {
    const menuFilteredTabs = tabs.filter((tab) => {
      const menuKey = menuKeyByTabKey[tab.key];
      return !menuKey || visibleMenuKeys.includes(menuKey);
    });

    if (Array.isArray(enableTabs)) {
      return menuFilteredTabs.filter((tab) => enableTabs.includes(tab.key));
    }
    return menuFilteredTabs;
  }, [enableTabs, tabs, visibleMenuKeys]);

  const toolSubOptions = useMemo(() => {
    return [
      {
        value: EXTERNAL_TOOLS_TAB,
        label: intl.formatMessage({
          id: 'baseListModal.tabs.external',
        }),
      },
      {
        value: BUILTIN_TOOLS_TAB,
        label: intl.formatMessage({
          id: 'baseListModal.tabs.builtin',
        }),
      },
    ];
  }, [intl]);

  const fetchBundledTools = useCallback(async () => {
    if (bundledTools.length > 0) return;
    setBundledToolLoading(true);
    try {
      const res = await getDcSystemConfig({
        paramCode: 'OPENCLAW_BUNDLED_TOOLS',
      });
      const list = JSON.parse(res?.paramValue || '[]');
      const parsedList = Array.isArray(list) ? list : [];
      setBundledTools(
        parsedList.map((item) => ({
          ...item,
          id: item.toolCode,
          resourceId: item.toolCode,
          resourceName: item.toolName,
          description: item.toolDescZh || item.toolDescEn || '',
          avatar: item.toolGroupName,
          toolCode: item.toolCode,
          toolName: item.toolName,
          isWildcard: item.isWildcard,
          toolGroup: item.toolGroup,
          toolGroupName: item.toolGroupName,
          grantResourceType: 'TOOLKIT',
          createUserName: item.createUserName || item.creatorName || item.toolGroupName,
        }))
      );
    } catch {
      setBundledTools([]);
    } finally {
      setBundledToolLoading(false);
    }
  }, [bundledTools.length]);

  const [activeTab, setActiveTab] = useState(displayTabs[0]?.key);
  const [resultData, setResultData] = useState({
    list: [],
    pagination: {
      pageNum: 1,
      pageSize: 10,
      total: 0,
      current: 1,
    },
  });

  const { list = [], pagination } = resultData;

  const getCatalog = useCallback(() => {
    dispatch({
      type: 'employeeMgr/getCatalogOnResource',
      payload: {
        catalogType: 6,
      },
      success: (res) => {
        setCatalogList(res);
        setCatalogId([]);
      },
    });
  }, [dispatch]);

  const getSourceList = useCallback(
    async (params) => {
      setSourceLoading(true);
      if (isPlugin) {
        const { pageNum, pageSize, ...restParams } = params || {};
        const payload = {
          keyword: searchKeyword || '',
          pageNum: pageNum || pagination.pageNum,
          pageSize: pageSize || pagination.pageSize,
          ...restParams,
        };

        try {
          let res = await listResourceUseAuth(payload);
          const pageInfo = res?.data || res || {};
          const rows = pageInfo?.list || pageInfo?.rows || [];
          console.log('rows', rows);
          setResultData({
            list: (rows || []).map((item) => ({
              ...item,
              id: item.resourceId || item.id,
              resourceId: item.resourceId || item.id,
              resourceName: item.resourceName || item.name,
              description: item.description || item.resourceDesc || '',
              avatar: item.avatar || item.logoUrl || item.pluginUrl,
              createUserName: item.createUserName || item.creatorName || item.publishUserName,
              createTime: item.createTime || item.publishTime,
              grantResourceType: item.grantResourceType || item.resourceBizType,
            })),
            pagination: {
              pageNum: Number(pageInfo.pageNum || pageInfo.pageIndex || 1),
              pageSize: Number(pageInfo.pageSize || pagination.pageSize),
              total: Number(pageInfo.total || 0),
              current: Number(pageInfo.pageNum || pageInfo.pageIndex || 1),
            },
          });
        } catch (error) {
          console.error('Failed to load resources:', error);
        } finally {
          setSourceLoading(false);
        }
        return;
      }

      const { pageNum, pageSize, ...restParams } = params || {};
      const payload = {
        pageNum: pageNum || pagination.pageNum,
        pageSize: pageSize || pagination.pageSize,
        keyword: searchKeyword,
        resourceBizTypeList: activeTab && [activeTab],
        catalogId: catalogId[0] || '',
        ...restParams,
      };

      try {
        let res = await listResourceUseAuth(payload);
        console.log(res);
        const pageInfo = res?.data || res || {};
        const list = pageInfo?.list || pageInfo?.rows || [];
        setResultData({
          list: (list || []).map((item) => ({
            ...item,
            id: item.itemId || item.objId,
            avatar: item.pluginUrl || item.logoUrl,
            name: item.itemName || item.name,
            description: item.resourceDesc ?? '',
            intro: item.pluginDesc || item.desc,
            createUserName: item.createUserName || item.publishUserName,
            createTime: item.createTime || item.publishTime,
          })),
          pagination: {
            pageNum: Number(pageInfo.pageNum || pageInfo.pageIndex || 1),
            pageSize: Number(pageInfo.pageSize || pagination.pageSize),
            total: Number(pageInfo.total || 0),
            current: Number(pageInfo.pageNum || pageInfo.pageIndex || 1),
          },
        });
      } catch (error) {
        console.error('Failed to load resources:', error);
      } finally {
        setSourceLoading(false);
      }
    },
    [pagination, isPlugin, isDataset, searchKeyword, catalogId, activeTab]
  );

  const onUpdateItem = useCallback(
    (item) => {
      setResultData((prev) => ({
        ...prev,
        list: prev.list.map((it) => (it.resourceId === item.resourceId ? item : it)),
      }));

      handleUpdateItem(item);
    },
    [isPlugin, handleUpdateItem]
  );

  useEffect(() => {
    if (!open) return;
    const firstTabKey = displayTabs?.[0]?.key;
    if (!firstTabKey) {
      setActiveTab(undefined);
      setResultData({
        list: [],
        pagination: {
          pageNum: 1,
          pageSize: 10,
          total: 0,
          current: 1,
        },
      });
      return;
    }
    const isActiveTabVisible = displayTabs.some((tab) => tab.key === activeTab);
    const currentTabKey = isActiveTabVisible ? activeTab : firstTabKey;

    if (currentTabKey !== activeTab) {
      setActiveTab(firstTabKey);
    }

    if (currentTabKey === 'TOOLKIT') {
      fetchBundledTools();
    }

    getCatalog();
    getSourceList({
      resourceBizTypeList: currentTabKey ? [currentTabKey] : undefined,
      pageNum: 1,
    });
  }, [open, digitalType, displayTabs]);

  const filteredBundledTools = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    if (!keyword) return bundledTools;
    return bundledTools.filter(
      (item) =>
        item.toolName?.toLowerCase().includes(keyword) ||
        item.toolDescZh?.toLowerCase().includes(keyword) ||
        item.toolDescEn?.toLowerCase().includes(keyword)
    );
  }, [bundledTools, searchKeyword]);

  const onSearch = useCallback(
    (values) => {
      if (isPlugin) {
        getSourceList({
          pageNum: 1,
          resourceBizTypeList: activeTab && [activeTab],
          ...values,
        });
        return;
      }
      getSourceList({
        pageNum: 1,
        name: searchKeyword,
        resourceBizTypeList: activeTab && [activeTab],
        ...values,
      });
    },
    [getSourceList, isPlugin, searchKeyword, activeTab]
  );

  return (
    <ModalDrawer
      type="modal"
      width={900}
      height={640}
      className={styles.toolConfigModal}
      closable={false}
      showFoot={false}
      footer={null}
      open={open}
      onCancel={onCancel}
      paddingSize="padding-none"
      bodyStyle={{ padding: 0, height: 640 }}
      styles={{ body: { padding: 0, height: 640 } }}
    >
      <div className={styles.container}>
        <div className={styles.left}>
          <span className={styles.modalTitle}>
            {intl.formatMessage({
              id: isPlugin ? 'baseListModal.configTool' : 'baseListModal.configKnowledge',
            })}
          </span>
          <Input
            suffix={<AntdIcon type="icon-a-Searchsousuo" />}
            value={searchName}
            onChange={(e) => setSearchName(e.target.value)}
            placeholder={intl.formatMessage({ id: 'baseListModal.searchCatalog' })}
          />
          <div
            className={classnames(styles.catalogList, {
              [styles.isLoading]: catalogLoading,
            })}
          >
            <Spin spinning={catalogLoading}>
              <DirectoryTree
                style={{ minHeight: 100 }}
                selectedKeys={catalogId}
                treeData={filteredCatalogList}
                fieldNames={{
                  title: 'catalogName',
                  key: 'catalogId',
                }}
                switcherIcon={null}
                onSelect={(key) => {
                  const selectedCatalogId = key?.[0];
                  const currentCatalogId = catalogId?.[0];
                  const isToggleOff = selectedCatalogId && `${selectedCatalogId}` === `${currentCatalogId}`;
                  const nextCatalogId = isToggleOff ? '' : selectedCatalogId || '';

                  setCatalogId(isToggleOff ? [] : key);
                  // 目录筛选与 tab 筛选同时生效；再次点击已选节点时取消目录筛选
                  onSearch({
                    catalogId: nextCatalogId,
                    resourceBizTypeList: activeTab ? [activeTab] : undefined,
                  });
                }}
              />
            </Spin>
          </div>
        </div>
        <div className={classnames(styles.right, 'ub ub-ver')}>
          <div className={styles.header}>
            <div className={styles.tabsContainer}>
              <Tabs
                activeKey={activeTab}
                onChange={(key) => {
                  setActiveTab(key);
                  if (key === 'TOOLKIT') {
                    setToolSubTab(EXTERNAL_TOOLS_TAB);
                    fetchBundledTools();
                  }
                  onSearch({ resourceBizTypeList: [key], catalogId: catalogId?.[0] || '' });
                }}
                items={displayTabs}
              />
            </div>
            <div className={styles.headerRight}>
              {activeTab === 'TOOLKIT' && (
                <Select
                  style={{ width: 80 }}
                  value={toolSubTab}
                  onChange={(value) => {
                    setToolSubTab(value);
                    if (value === BUILTIN_TOOLS_TAB) {
                      fetchBundledTools();
                    }
                  }}
                  options={toolSubOptions}
                />
              )}
              <div className={styles.searchContainer}>
                <Input
                  style={{ width: 150 }}
                  suffix={<AntdIcon type="icon-a-Searchsousuo" onClick={() => onSearch()} />}
                  value={searchKeyword}
                  onChange={(e) => setSearchKeyword(e.target.value)}
                  onPressEnter={() => onSearch()}
                  placeholder={intl.formatMessage({
                    id: isPlugin ? 'baseListModal.searchTool' : 'baseListModal.searchKnowledge',
                  })}
                />
              </div>
              <AntdIcon type="icon-a-Closeguanbi" style={{ fontSize: '16px' }} onClick={onCancel} />
            </div>
          </div>
          <Spin
            spinning={toolSubTab === BUILTIN_TOOLS_TAB ? bundledToolLoading : sourceLoading}
            wrapperClassName={styles.spinningWrapper}
          >
            {(() => {
              const displayList =
                activeTab === 'TOOLKIT' && toolSubTab === BUILTIN_TOOLS_TAB ? filteredBundledTools : list;
              const isBuiltinMode = activeTab === 'TOOLKIT' && toolSubTab === BUILTIN_TOOLS_TAB;
              if (displayList.length) {
                return (
                  <div className={styles.cardListWrap}>
                    <div className={styles.cardList}>
                      {displayList.map((item) => {
                        let isSelected = false;
                        if (isPlugin) {
                          isSelected = !!skills.find((it) => `${it.resourceId}` === `${item.resourceId}`);
                        } else {
                          isSelected = !!knowledgeBases.find(
                            (it) => !!it.items?.find((i) => `${i.resourceId}` === `${item.resourceId}`)
                          );
                        }

                        if (['VIEW', 'OBJECT'].includes(activeTab)) {
                          return (
                            <ItemCard2
                              key={item.id}
                              item={item}
                              isPlugin={isPlugin}
                              isSelected={isSelected}
                              isDataset={isDataset}
                              handleSelect={handleSelect}
                              handleRemove={handleRemove}
                              onUpdateItem={onUpdateItem}
                            />
                          );
                        }
                        if (isBuiltinMode) {
                          return (
                            <ItemCard
                              key={item.id}
                              appId={appId}
                              item={item}
                              isPlugin={isPlugin}
                              isDataset={isDataset}
                              reload={reload}
                              handleSelect={(selectedItem) => {
                                const relToolsItem = {
                                  ...selectedItem,
                                  resourceId: selectedItem.toolCode,
                                  relTools: selectedItem.toolCode,
                                };
                                handleSelect(relToolsItem);
                              }}
                              skills={skills}
                              knowledgeBases={knowledgeBases}
                              handleRemove={handleRemove}
                            />
                          );
                        }
                        return (
                          <ItemCard
                            key={item.id}
                            appId={appId}
                            item={item}
                            isPlugin={isPlugin}
                            isDataset={isDataset}
                            reload={reload}
                            handleSelect={handleSelect}
                            skills={skills}
                            knowledgeBases={knowledgeBases}
                            handleRemove={handleRemove}
                          />
                        );
                      })}
                    </div>
                    {!isBuiltinMode && (
                      <Pagination
                        showMuit
                        pageAllCount={displayList.length}
                        pagination={{
                          ...pagination,
                          onChange: (pageNum, pageSize) => {
                            getSourceList({ pageNum, pageSize, resourceBizTypeList: activeTab && [activeTab] });
                          },
                          showSelectInf: false,
                        }}
                      />
                    )}
                  </div>
                );
              }
              return <Empty />;
            })()}
          </Spin>
        </div>
      </div>
    </ModalDrawer>
  );
}

export default BaseListModal;
