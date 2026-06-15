import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Breadcrumb, Dropdown, Empty, Input, List, Tooltip, Typography } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useIntl, useLocation, useNavigate, useSelector } from '@umijs/max';
import { trim } from 'lodash';
import AntdIcon from '@/components/AntdIcon';
import { DragType, type IDragType } from '@/components/QueryInput/withDrag';
import ResourceDetail from '@/components/Resources/components/ResourceDetail';
import InfiniteScrollAntdList from '@/layout/sider/components/InfiniteScrollAntdList';
import employeeStyles from '@/layout/sider/components/EmployeeList/index.module.less';
import { queryDigEmployeeRelResourceAuth, queryResourceMembers } from '@/pages/manager/service/resources';
import SkillDetailDrawer from '@/pages/manager/components/SkillDetailDrawer/SkillDetailDrawer';
import { ResourceTypeMap } from '@/constants/resource';
import { resourceBizTypeMap } from '@/constants/knowledge';
import useGlobal from '@/hooks/useGlobal';
import ActiveSiderAgentBar, { useActiveSiderAgent } from '@/layout/sider/components/ActiveSiderAgentBar';
import { SiderContentContext } from '@/layout/sider/siderContentContext';
import styles from './index.module.less';

const { Title, Paragraph } = Typography;

type ResourceSiderType = 'TOOL' | 'VIEW' | 'OBJECT' | 'SKILL';
const PAGE_SIZE = 30;

interface ResourceItem {
  resourceId: string;
  resourceCode?: string;
  resourceName: string;
  description?: string;
  resourceDesc?: string;
  resourceLogoUrl?: string;
  resourceBizType?: string;
  resourceSourcePkId?: string;
  createTime?: number | string;
  createUserName?: string;
  extInfo?: any;
  isTop?: string | number;
}

interface Props {
  resourceType: ResourceSiderType;
}

const resourceConfigMap: Record<
  ResourceSiderType,
  {
    icon: string;
    labelId: string;
    centerLabelId: string;
    navigatePath: string;
    siderKey: string;
    resourceBizTypeList: string[];
  }
> = {
  TOOL: {
    icon: 'icon-chajian',
    labelId: 'common.tool',
    centerLabelId: 'resourceTabs.toolCenter',
    navigatePath: '/toolCenter',
    siderKey: 'tool',
    resourceBizTypeList: [ResourceTypeMap.Agent, ResourceTypeMap.MCP, ResourceTypeMap.TOOLKIT],
  },
  VIEW: {
    icon: 'icon-a-yemian-line',
    labelId: 'common.resourceType.view',
    centerLabelId: 'resourceTabs.viewCenter',
    navigatePath: '/viewCenter',
    siderKey: 'view',
    resourceBizTypeList: [ResourceTypeMap.VIEW],
  },
  OBJECT: {
    icon: 'icon-tongxun',
    labelId: 'common.resourceType.object',
    centerLabelId: 'resourceTabs.objectCenter',
    navigatePath: '/objectCenter',
    siderKey: 'object',
    resourceBizTypeList: [ResourceTypeMap.OBJECT],
  },
  SKILL: {
    icon: 'icon-chajian',
    labelId: 'common.skill',
    centerLabelId: 'resourceTabs.skillCenter',
    navigatePath: '/skillCenter',
    siderKey: 'skill',
    resourceBizTypeList: [ResourceTypeMap.SKILL],
  },
};

const ResourceSiderPanel: React.FC<Props> = ({ resourceType }) => {
  const intl = useIntl();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { EventEmitter } = useGlobal();
  const { userInfo } = useSelector(({ user }: any) => ({
    userInfo: user.userInfo,
  }));
  const { setDetailPanel, clearDetailPanel } = useContext(SiderContentContext);
  const listFetchRef = useRef(false);
  const itemClickTimerRef = useRef<number | null>(null);
  const keywordRef = useRef('');
  const paginationRef = useRef({
    pageNum: 0,
    total: 0,
    loadedCount: 0,
  });
  const [searchValue, setSearchValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [resourceList, setResourceList] = useState<ResourceItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [resourceDetails, setResourceDetails] = useState<Record<string, any>>({});

  // 下钻相关状态
  interface BreadcrumbItem {
    resourceId: string;
    resourceName: string;
    resourceType: string;
    originalList: ResourceItem[];
  }
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([]);
  const [currentLevelOriginalList, setCurrentLevelOriginalList] = useState<ResourceItem[]>([]); // 当前层级的原始列表，用于前端搜索
  const config = resourceConfigMap[resourceType];

  /**
   * 获取资源详情数据
   */
  const getResourceDetail = async (resourceId: string): Promise<any> => {
    if (resourceDetails[resourceId]) {
      return resourceDetails[resourceId];
    }

    try {
      const data = await queryResourceMembers({ resourceId });
      setResourceDetails((prev) => ({ ...prev, [resourceId]: data }));
      return data;
    } catch (error) {
      console.error('Error fetching resource detail:', error);
      return null;
    }
  };

  /**
   * 解析资源的extInfo.targetContent
   */
  const parseTargetContent = (itemOrDetail: any) => {
    try {
      const targetContent = itemOrDetail?.extInfo?.targetContent
        ? JSON.parse(itemOrDetail.extInfo.targetContent)
        : null;
      return targetContent;
    } catch (error) {
      return null;
    }
  };

  /**
   * 判断是否处于下钻状态
   */
  const isInDrillDown = (): boolean => {
    return breadcrumb.length > 0;
  };

  /**
   * 判断资源是否可下钻
   */
  const canDrillDown = (item: ResourceItem): boolean => {
    // 根层级：只有 VIEW 和 OBJECT 类型可以下钻
    if (!isInDrillDown()) {
      return resourceType === 'VIEW' || resourceType === 'OBJECT';
    }

    // 下钻层级：关联对象（有 resourceCode）可以继续下钻到属性
    // 属性（没有 resourceCode，resourceId 包含 "-"）不能继续下钻
    const resourceIdStr = String(item.resourceId);
    return !!item.resourceCode && !resourceIdStr.includes('-');
  };

  /**
   * 进入下钻层级
   */
  const handleDrillDown = async (item: ResourceItem) => {
    setLoading(true);
    try {
      const detail = await getResourceDetail(item.resourceId);
      const targetContent = detail ? parseTargetContent(detail) : parseTargetContent(item);

      if (targetContent) {
        // 将当前列表保存到面包屑中
        const newBreadcrumbItem = {
          resourceId: item.resourceId,
          resourceName: item.resourceName,
          resourceType: resourceType,
          originalList: [...resourceList],
        };

        // 转换下钻数据为 ResourceItem 格式
        const drillItems: ResourceItem[] = [];

        // 添加关联对象
        if (targetContent.objects && targetContent.objects.length > 0) {
          targetContent.objects.forEach((obj: any) => {
            drillItems.push({
              resourceId: obj.resourceId,
              resourceName: obj.resourceName,
              resourceCode: obj.resourceCode,
              resourceDesc: obj.resourceDesc,
            });
          });
        }

        // 添加属性
        if (targetContent.fields && targetContent.fields.length > 0) {
          targetContent.fields.forEach((field: any) => {
            drillItems.push({
              resourceId: `${item.resourceId}-${field.propertyName}`,
              resourceName: field.propertyName,
              resourceDesc: field.propertyCode,
            });
          });
        }

        setBreadcrumb((prev) => [...prev, newBreadcrumbItem]);
        setCurrentLevelOriginalList(drillItems); // 保存当前层级的原始列表用于搜索
        setResourceList(drillItems);
        setHasMore(false);
      }
    } catch (error) {
      console.error('Error drill down:', error);
    } finally {
      setLoading(false);
    }
  };

  /**
   * 判断是否在下钻状态
   */
  const activeSiderAgent = useActiveSiderAgent();
  const isResourceCenterPage = pathname.startsWith(config.navigatePath);
  const placeholder = intl.formatMessage(
    { id: 'form.inputPlaceholder' },
    {
      content: intl.formatMessage({ id: 'knowledgeDetail.keywords' }),
    }
  );

  const loadResources = useCallback(
    async (options?: { reset?: boolean; queryKeyword?: string }) => {
      if (listFetchRef.current) return;
      const { reset = false, queryKeyword = keywordRef.current } = options || {};
      const pageNum = reset ? 1 : paginationRef.current.pageNum + 1;
      listFetchRef.current = true;
      setLoading(true);
      try {
        // if (resourceType === 'SKILL') {
        //   const response = await qrySkillListByUserCode({
        //     userCode: userInfo?.userCode,
        //     resourceId: activeSiderAgent.resourceId,
        //     keyword: trim(queryKeyword),
        //   });
        //   const rows = (Array.isArray(response) ? response : []).map((item: any, index: number) => ({
        //     ...item,
        //     resourceId: item.skillPath || item.resourceId || index,
        //     resourceName: item.skillName || item.resourceName,
        //     resourceDesc: item.skillPath || item.skillDescEn || item.resourceDesc,
        //     resourceBizType: ResourceTypeMap.SKILL,
        //     id: item.skillPath || item.resourceId || index,
        //   }));
        //   paginationRef.current = {
        //     pageNum: 1,
        //     total: rows.length,
        //     loadedCount: rows.length,
        //   };
        //   setResourceList(rows);
        //   setHasMore(false);
        //   return;
        // }

        const response = await queryDigEmployeeRelResourceAuth({
          pageNum,
          pageSize: PAGE_SIZE,
          keyword: trim(queryKeyword),
          resourceId: activeSiderAgent.resourceId,
          resourceBizTypeList: config.resourceBizTypeList,
        });
        const rows = Array.isArray(response?.rows) ? response.rows : Array.isArray(response?.list) ? response.list : [];
        const responsePageNum = Number(response?.pageNum) || pageNum;
        const responseTotal = Number(response?.total) || 0;
        const loadedCount = reset ? rows.length : paginationRef.current.loadedCount + rows.length;
        paginationRef.current = {
          pageNum: responsePageNum,
          total: responseTotal,
          loadedCount,
        };
        setResourceList((prev) => (reset ? rows : [...prev, ...rows]));
        setHasMore(responseTotal > 0 ? loadedCount < responseTotal : rows.length >= PAGE_SIZE);
      } catch {
        if (reset) {
          setResourceList([]);
          paginationRef.current = {
            pageNum: 0,
            total: 0,
            loadedCount: 0,
          };
        }
        setHasMore(false);
      } finally {
        listFetchRef.current = false;
        setLoading(false);
      }
    },
    [activeSiderAgent.resourceId, config.resourceBizTypeList, resourceType, userInfo?.userCode]
  );

  /**
   * 清空面包屑，返回根层级
   */
  const handleReset = () => {
    if (breadcrumb.length > 0) {
      setBreadcrumb([]);
      loadResources({ reset: true }); // 重新加载根层级数据，reset=true 确保从第一页开始
    }
  };

  const handleBreadcrumbClick = (index: number) => {
    const newBreadcrumb = breadcrumb.slice(0, index + 1);
    const targetLevelOriginalList = breadcrumb[index + 1]?.originalList ?? [];
    setBreadcrumb(newBreadcrumb);
    setResourceList(targetLevelOriginalList);
    setCurrentLevelOriginalList(targetLevelOriginalList);
    setHasMore(false);
  };

  useEffect(() => {
    keywordRef.current = '';
    paginationRef.current = {
      pageNum: 0,
      total: 0,
      loadedCount: 0,
    };
    setSearchValue('');
    setHasMore(false);
    loadResources({ reset: true, queryKeyword: '' });
  }, [loadResources, resourceType]);

  useEffect(() => {
    const handleDefaultDigitalEmployeeChanged = () => {
      paginationRef.current = {
        pageNum: 0,
        total: 0,
        loadedCount: 0,
      };
      loadResources({ reset: true, queryKeyword: keywordRef.current });
    };
    EventEmitter.on('default-digital-employee-changed', handleDefaultDigitalEmployeeChanged);
    return () => {
      EventEmitter.off('default-digital-employee-changed', handleDefaultDigitalEmployeeChanged);
    };
  }, [EventEmitter, loadResources]);

  useEffect(() => {
    const handleResourceInstalled = () => {
      paginationRef.current = {
        pageNum: 0,
        total: 0,
        loadedCount: 0,
      };
      loadResources({ reset: true, queryKeyword: keywordRef.current });
    };

    window.addEventListener('digitalEmployeeResourceInstalled', handleResourceInstalled);
    return () => {
      window.removeEventListener('digitalEmployeeResourceInstalled', handleResourceInstalled);
    };
  }, [loadResources]);

  const handleSearch = () => {
    const nextKeyword = trim(searchValue);
    keywordRef.current = nextKeyword;

    if (isInDrillDown()) {
      // 下钻状态：前端模糊搜索
      if (!nextKeyword) {
        // 搜索框为空，显示原始列表
        setResourceList(currentLevelOriginalList);
      } else {
        // 根据关键字过滤，只匹配 resourceName 和 resourceDesc
        const filtered = currentLevelOriginalList.filter((item) => {
          const nameMatch = item.resourceName?.toLowerCase().includes(nextKeyword.toLowerCase());
          const descMatch = item.resourceDesc?.toLowerCase().includes(nextKeyword.toLowerCase());
          return nameMatch || descMatch;
        });
        setResourceList(filtered);
      }
    } else {
      // 非下钻状态：后端搜索
      paginationRef.current = {
        pageNum: 0,
        total: 0,
        loadedCount: 0,
      };
      loadResources({ reset: true, queryKeyword: nextKeyword });
    }
  };

  const getResourceIcon = () => {
    if (resourceType === 'TOOL' || resourceType === 'SKILL') return 'icon-chajiantubiao';
    return 'icon-chuangjianfangshi-shujuku';
  };

  const getResourceName = () => {
    if (resourceType === 'TOOL') return intl.formatMessage({ id: 'resource.tool' });
    if (resourceType === 'VIEW') return intl.formatMessage({ id: 'resource.view' });
    if (resourceType === 'OBJECT') return intl.formatMessage({ id: 'resource.object' });
    if (resourceType === 'SKILL') return intl.formatMessage({ id: 'common.skill' });
    return intl.formatMessage({ id: 'resource.default' });
  };

  const handleDetail = (item: ResourceItem) => {
    const { resourceBizType, resourceId } = item;
    const closeDetailPanel = () => clearDetailPanel?.();

    if (
      resourceBizType &&
      [
        resourceBizTypeMap.MCP,
        resourceBizTypeMap.TOOL,
        resourceBizTypeMap.TOOLKIT,
        resourceBizTypeMap.AGENT,
        ResourceTypeMap.SKILL,
      ].includes(resourceBizType)
    ) {
      const titleMap: Record<string, string> = {
        [resourceBizTypeMap.MCP]: intl.formatMessage({ id: 'common.mcpService' }),
        [resourceBizTypeMap.TOOL]: intl.formatMessage({ id: 'common.tool' }),
        [resourceBizTypeMap.TOOLKIT]: intl.formatMessage({ id: 'common.toolkit' }),
        [resourceBizTypeMap.AGENT]: intl.formatMessage({ id: 'common.agent' }),
        [ResourceTypeMap.SKILL]: intl.formatMessage({ id: 'common.skill' }),
      };

      if (resourceId) {
        setDetailPanel?.(
          <SkillDetailDrawer
            resourceId={resourceId}
            title={titleMap[resourceBizType] || intl.formatMessage({ id: 'common.detail' })}
            open
            panel
            onClose={closeDetailPanel}
          />
        );
      }
      return;
    }

    setDetailPanel?.(
      <ResourceDetail
        visible
        panel
        resourceId={item.resourceId}
        item={item}
        resourceType={resourceType}
        resourceName={getResourceName()}
        onCancel={closeDetailPanel}
        onEdit={() => {}}
      />,
      { width: 350 }
    );
  };

  /**
   * 渲染资源详情下拉菜单
   */
  const renderDetailDropdown = (item: ResourceItem) => {
    return (
      <Dropdown
        key="detail"
        trigger={['hover']}
        overlayClassName={employeeStyles.mydropdown}
        menu={{
          items: [
            {
              key: 'detail',
              label: (
                <div className={employeeStyles.dropdownMenuItem}>{intl.formatMessage({ id: 'common.detail' })}</div>
              ),
            },
          ],
          onClick: ({ domEvent }) => {
            domEvent.preventDefault();
            domEvent.stopPropagation();
            handleDetail(item);
          },
        }}
      >
        <span
          onClick={(event) => {
            event.stopPropagation();
            event.preventDefault();
          }}
        >
          <AntdIcon type="icon-a-Moregengduo" />
        </span>
      </Dropdown>
    );
  };

  const getQuoteType = (): IDragType => {
    if (resourceType === 'TOOL') return DragType.tool;
    if (resourceType === 'SKILL') return DragType.SKILL;
    return DragType.OBJECT;
  };

  const handleQuoteResource = (item: ResourceItem) => {
    EventEmitter.emit('queryInput-insert-item', {
      item: { ...item, isFromResourceModule: true },
      type: getQuoteType(),
    });
  };

  const clearItemClickTimer = useCallback(() => {
    if (itemClickTimerRef.current !== null) {
      window.clearTimeout(itemClickTimerRef.current);
      itemClickTimerRef.current = null;
    }
  }, []);

  const handleResourceItemClick = useCallback(
    (item: ResourceItem, drillable: boolean) => {
      clearItemClickTimer();
      itemClickTimerRef.current = window.setTimeout(() => {
        itemClickTimerRef.current = null;
        if (drillable) {
          void handleDrillDown(item);
        }
      }, 220);
    },
    [clearItemClickTimer, handleDrillDown]
  );

  const handleResourceItemDoubleClick = useCallback(
    (item: ResourceItem) => {
      clearItemClickTimer();
      handleQuoteResource(item);
    },
    [clearItemClickTimer, handleQuoteResource]
  );

  useEffect(() => {
    return clearItemClickTimer;
  }, [clearItemClickTimer]);

  const navigatePath = isResourceCenterPage ? { pathname: '/chat' } : config.navigatePath;
  const navigateState = isResourceCenterPage ? { state: { keepSiderActiveKey: config.siderKey } } : undefined;

  return (
    <div className={styles.container}>
      <ActiveSiderAgentBar agent={activeSiderAgent} />
      <div className={styles.router} onClick={() => navigate(navigatePath, navigateState)}>
        <AntdIcon type={config.icon} />
        <span className={styles.middle}>{intl.formatMessage({ id: config.centerLabelId })}</span>
        <AntdIcon type={isResourceCenterPage ? 'icon-a-Leftzuo' : 'icon-a-Rightyou'} className={styles.routerIcon} />
      </div>
      {isInDrillDown() && (
        <Breadcrumb className={styles.breadcrumb}>
          <Breadcrumb.Item key="-1">
            <span onClick={handleReset}>
              <AntdIcon type="icon-a-Leftzuo" className={styles.breadcrumbBackIcon} />
              {intl.formatMessage({ id: 'dialogueRecord.all' })}
            </span>
          </Breadcrumb.Item>
          {breadcrumb.map((crumb, index) => {
            const isLast = index === breadcrumb.length - 1;
            return (
              <Breadcrumb.Item key={crumb.resourceId}>
                {isLast ? (
                  <span className={styles.breadcrumbUnclickable}>{crumb.resourceName}</span>
                ) : (
                  <span className={styles.breadcrumbClickable} onClick={() => handleBreadcrumbClick(index)}>
                    {crumb.resourceName}
                  </span>
                )}
              </Breadcrumb.Item>
            );
          })}
        </Breadcrumb>
      )}
      <Input
        value={searchValue}
        suffix={<SearchOutlined onClick={handleSearch} />}
        placeholder={placeholder}
        onChange={(event) => setSearchValue(event.target.value)}
        onPressEnter={handleSearch}
      />
      <div className={styles.listContainer}>
        <InfiniteScrollAntdList
          className={employeeStyles.employeesList}
          dataSource={resourceList}
          hasMore={hasMore}
          loading={loading}
          next={() => !isInDrillDown() && loadResources()}
          renderEmpty={<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          renderItem={(item: ResourceItem) => {
            const drillable = canDrillDown(item);

            return (
              <List.Item
                key={item.resourceId}
                className={styles.resourceItem}
                onClick={() => handleResourceItemClick(item, drillable)}
                onDoubleClick={() => handleResourceItemDoubleClick(item)}
                actions={!isInDrillDown() ? [renderDetailDropdown(item)] : undefined}
              >
                <List.Item.Meta
                  avatar={
                    <span className={styles.resourceAvatar}>
                      {drillable && <AntdIcon type="icon-a-xiangyou" className={styles.drillIcon} />}
                      <AntdIcon
                        type={
                          String(item.resourceId).includes('-')
                            ? 'icon-a-Database-networkshujukuwangluo'
                            : getResourceIcon()
                        }
                      />
                    </span>
                  }
                  title={
                    <Title className={employeeStyles.name}>
                      <Tooltip title={item.resourceName}>
                        <span className={employeeStyles.nameRow}>
                          <span className={employeeStyles.nameText}>{item.resourceName}</span>
                        </span>
                      </Tooltip>
                    </Title>
                  }
                  description={
                    item.resourceDesc && (
                      <Paragraph
                        className={employeeStyles.description}
                        ellipsis={{ tooltip: { title: item.resourceDesc, placement: 'right' } }}
                      >
                        {item.resourceDesc}
                      </Paragraph>
                    )
                  }
                />
              </List.Item>
            );
          }}
        />
      </div>
    </div>
  );
};

export default ResourceSiderPanel;
