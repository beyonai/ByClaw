import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Breadcrumb, Button, Dropdown, Empty, Input, List, message, Modal, Tooltip, Typography } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useIntl, useLocation, useNavigate, useSelector } from '@umijs/max';
import { trim } from 'lodash';
import AntdIcon from '@/components/AntdIcon';
import { DragType, type IDragType } from '@/components/QueryInput/withDrag';
import ResourceDetail from '@/components/Resources/components/ResourceDetail';
import PropertyDetail from '@/components/Resources/components/PropertyDetail';
import InfiniteScrollAntdList from '@/layout/sider/components/InfiniteScrollAntdList';
import employeeStyles from '@/layout/sider/components/EmployeeList/index.module.less';
import {
  deleteSkill,
  queryDigEmployeeRelResourceAuth,
  queryResourceMembers,
  queryWorkspaceSkillList,
  uploadSkillZip,
} from '@/pages/manager/service/resources';
import SkillDetailDrawer from '@/pages/manager/components/SkillDetailDrawer/SkillDetailDrawer';
import AddAuthModal from '@/pages/manager/components/AuthListDrawer/AddAuthModal';
import {
  isWorkspaceSkill,
  mapWorkspaceSkillRows,
  SKILL_DISPLAY_SOURCE_USER_DEVELOPED,
  type WorkspaceSkillItem,
} from '@/components/Resources/workspaceSkill/utils';
import { useWorkspaceSkillActions } from '@/components/Resources/workspaceSkill/useWorkspaceSkillActions';
import { useDigitalEmployeeManagePermission } from '@/components/Resources/workspaceSkill/useDigitalEmployeeManagePermission';
import { batchHandleAuth, listAuthDetail } from '@/pages/manager/service/DigitalResourceMgr';
import { uninstallDigitalEmployeeRelResources } from '@/pages/manager/service/DigitalEmployeeMgr';
import { ResourceTypeMap } from '@/constants/resource';
import { resourceBizTypeMap } from '@/constants/knowledge';
import useGlobal from '@/hooks/useGlobal';
import ActiveSiderAgentBar, { useActiveSiderAgent } from '@/layout/sider/components/ActiveSiderAgentBar';
import { SiderContentContext } from '@/layout/sider/siderContentContext';
import { getManagerMenuConfig, normalizeMenuUrl } from '@/pages/manager/layout/sider/menuConfig';
import { getRuntimeActualUrl } from '@/utils';
import { getToken } from '@/utils/auth';
import { getFileUrl } from '@/utils/file';
import styles from './index.module.less';

const { Title, Paragraph } = Typography;

type ResourceSiderType = 'TOOL' | 'VIEW' | 'OBJECT' | 'SKILL';
const PAGE_SIZE = 30;

interface ResourceItem {
  resourceId: string | number;
  resourceCode?: string;
  resourceName: string;
  description?: string;
  resourceDesc?: string;
  resourceLogoUrl?: string;
  avatar?: string;
  logoUrl?: string;
  resourceImageUrl?: string;
  resourceImage?: string;
  coverUrl?: string;
  coverImageUrl?: string;
  resourceBizType?: string;
  resourceSourcePkId?: string;
  createTime?: number | string;
  createUserName?: string;
  extInfo?: any;
  isTop?: string | number;
  propertyName?: string;
  propertyCode?: string;
  propertyGroup?: string;
  dataType?: string;
  sourceType?: string;
  displaySourceType?: string;
  resourceBacked?: boolean;
  skillPath?: string;
  skillDocObjectKey?: string;
  useStartTime?: string;
  objectKey?: string;
  targetContent?: string;
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

const PROPERTY_RESOURCE_TYPE = 'PROPERTY';
const SHARE_GRANT_TYPE = 'FORCE_USE';
const UI_SKILL_MENU_CODE = 'menu_ui_agent';
const UI_SKILL_MENU_NAME = '界面技能';

const getArrayData = (response: any) => {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.rows)) return response.rows;
  if (Array.isArray(response?.list)) return response.list;
  if (Array.isArray(response?.data)) return response.data;
  return [];
};

const getResourceUniqueKey = (item: ResourceItem, index: number) => {
  const id = item?.resourceId ?? item?.resourceSourcePkId ?? item?.resourceCode;
  if (id === undefined || id === null || String(id) === '') {
    return `__resource_index_${index}`;
  }
  return `${item?.resourceBizType || ''}:${String(id)}`;
};

const dedupeResourceList = (items: ResourceItem[]) => {
  const seen = new Set<string>();
  return items.filter((item, index) => {
    const key = getResourceUniqueKey(item, index);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

const parseResourceTargetContent = (item?: ResourceItem) => {
  const targetContent = item?.extInfo?.targetContent || item?.targetContent;
  if (!targetContent || typeof targetContent !== 'string') {
    return null;
  }
  try {
    return JSON.parse(targetContent);
  } catch {
    return null;
  }
};

const getResourceImageUrl = (item?: ResourceItem) => {
  const targetContent = parseResourceTargetContent(item);
  return (
    item?.resourceLogoUrl ||
    item?.avatar ||
    item?.logoUrl ||
    item?.resourceImageUrl ||
    item?.resourceImage ||
    item?.coverUrl ||
    item?.coverImageUrl ||
    targetContent?.resourceLogoUrl ||
    targetContent?.avatar ||
    targetContent?.logoUrl ||
    targetContent?.resourceImageUrl ||
    targetContent?.resourceImage ||
    targetContent?.coverUrl ||
    targetContent?.coverImageUrl ||
    ''
  );
};

const mapBoundSkillRows = (rows: ResourceItem[], resourceType: ResourceSiderType) => {
  if (resourceType !== 'SKILL') {
    return rows;
  }
  return rows.map((item) => ({
    ...item,
    resourceLogoUrl: getResourceImageUrl(item),
    resourceBacked: true,
  }));
};

const getGrantItem = (item: any) => ({
  ...item,
  id: `${String(item.grantToObjType).toLowerCase()}_${item.grantToObjId}`,
  name: item.grantToObjName,
  type: item.grantToObjType,
});

const transformGrantItem = (item: any) => {
  const [, idFromKey] = String(item.id || '').split('_');
  return {
    grantToObjId: idFromKey || item.grantToObjId,
    grantToObjType: item.type || item.grantToObjType,
  };
};

interface AuthDetailResponse {
  code?: number;
  msg?: string;
  data?: {
    redList?: any[];
    blackList?: any[];
  };
}

interface AuthSaveResponse {
  code?: number;
  msg?: string;
}

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
  const skillUploadInputRef = useRef<HTMLInputElement | null>(null);
  const keywordRef = useRef('');
  const resourceListRef = useRef<ResourceItem[]>([]);
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
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareRecord, setShareRecord] = useState<ResourceItem | null>(null);
  const [shareAuthList, setShareAuthList] = useState<any[]>([]);
  const [shareBlackList, setShareBlackList] = useState<any[]>([]);
  const [skillUploading, setSkillUploading] = useState(false);

  // 下钻相关状态
  interface BreadcrumbItem {
    resourceId: string;
    resourceName: string;
    resourceType: string;
    originalList: ResourceItem[];
  }
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([]);
  const breadcrumbRef = useRef<BreadcrumbItem[]>([]);
  const [currentLevelOriginalList, setCurrentLevelOriginalList] = useState<ResourceItem[]>([]); // 当前层级的原始列表，用于前端搜索
  const config = resourceConfigMap[resourceType];

  useEffect(() => {
    resourceListRef.current = resourceList;
  }, [resourceList]);

  useEffect(() => {
    breadcrumbRef.current = breadcrumb;
  }, [breadcrumb]);

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
      const detail = await getResourceDetail(String(item.resourceId));
      const targetContent = detail ? parseTargetContent(detail) : parseTargetContent(item);

      if (targetContent) {
        // 将当前列表保存到面包屑中
        const newBreadcrumbItem = {
          resourceId: String(item.resourceId),
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
              resourceBizType: 'OBJECT',
            });
          });
        }

        // 添加属性
        if (targetContent.fields && targetContent.fields.length > 0) {
          targetContent.fields.forEach((field: any) => {
            drillItems.push({
              ...field,
              resourceId: field.propertyCode,
              resourceName: field.propertyName,
              resourceDesc: field.propertyCode,
              resourceBizType: PROPERTY_RESOURCE_TYPE,
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
      if (!activeSiderAgent.resourceId) {
        if (reset) {
          resourceListRef.current = [];
          setResourceList([]);
          paginationRef.current = {
            pageNum: 0,
            total: 0,
            loadedCount: 0,
          };
        }
        setHasMore(false);
        setLoading(false);
        return;
      }
      const pageNum = reset ? 1 : paginationRef.current.pageNum + 1;
      listFetchRef.current = true;
      setLoading(true);
      try {
        const response = await queryDigEmployeeRelResourceAuth({
          pageNum,
          pageSize: PAGE_SIZE,
          keyword: trim(queryKeyword),
          resourceId: activeSiderAgent.resourceId,
          resourceBizTypeList: config.resourceBizTypeList,
        });
        const rows = mapBoundSkillRows(getArrayData(response), resourceType);
        let workspaceSkillRows: ResourceItem[] = [];
        if (resourceType === 'SKILL' && reset && breadcrumbRef.current.length === 0) {
          try {
            const workspaceSkillResponse = await queryWorkspaceSkillList({
              keyword: trim(queryKeyword),
              resourceId: activeSiderAgent.resourceId,
              userCode: userInfo?.userCode,
            });
            workspaceSkillRows = mapWorkspaceSkillRows(getArrayData(workspaceSkillResponse)) as ResourceItem[];
          } catch (error) {
            console.warn('query workspace skills failed', error);
          }
        }
        const responsePageNum = Number(response?.pageNum) || pageNum;
        const responseTotal = Number(response?.total) || 0;

        const previousList = reset ? [] : resourceListRef.current;
        const nextRows = reset ? [...rows, ...workspaceSkillRows] : rows;
        const nextList = reset ? dedupeResourceList(nextRows) : dedupeResourceList([...previousList, ...nextRows]);
        const boundLoadedCount = reset
          ? rows.length
          : previousList.filter((item) => !isWorkspaceSkill(item)).length + rows.length;
        const loadedCount = resourceType === 'SKILL' ? boundLoadedCount : nextList.length;
        const hasNewUniqueRows = nextList.length > previousList.length;
        paginationRef.current = {
          pageNum: responsePageNum,
          total: responseTotal,
          loadedCount,
        };
        resourceListRef.current = nextList;
        setResourceList(nextList);
        setHasMore(
          responseTotal > 0
            ? rows.length > 0 && loadedCount < responseTotal && (reset || hasNewUniqueRows)
            : rows.length >= PAGE_SIZE && hasNewUniqueRows
        );
      } catch {
        if (reset) {
          resourceListRef.current = [];
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
      breadcrumbRef.current = [];
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

  useEffect(() => {
    const handleResourceTypeReload = (payload: string | { resourceType?: string }) => {
      const nextResourceType = typeof payload === 'string' ? payload : payload?.resourceType;
      if (nextResourceType !== 'SKILL' || resourceType !== 'SKILL' || isInDrillDown()) {
        return;
      }
      paginationRef.current = {
        pageNum: 0,
        total: 0,
        loadedCount: 0,
      };
      loadResources({ reset: true, queryKeyword: keywordRef.current });
    };

    EventEmitter.on('beyond-resourceList-resourceType-reload', handleResourceTypeReload);
    return () => {
      EventEmitter.off('beyond-resourceList-resourceType-reload', handleResourceTypeReload);
    };
  }, [EventEmitter, loadResources, resourceType, breadcrumb.length]);

  useEffect(() => {
    const handleSiderMenuRefresh = (payload?: { key?: string }) => {
      if (payload?.key !== config.siderKey) {
        return;
      }

      if (breadcrumbRef.current.length > 0) {
        breadcrumbRef.current = [];
        setBreadcrumb([]);
        setCurrentLevelOriginalList([]);
      }
      paginationRef.current = {
        pageNum: 0,
        total: 0,
        loadedCount: 0,
      };
      resourceListRef.current = [];
      setResourceList([]);
      setHasMore(false);
      loadResources({ reset: true, queryKeyword: keywordRef.current });
    };

    EventEmitter.on('sider-menu-tab-click-refresh', handleSiderMenuRefresh);
    return () => {
      EventEmitter.off('sider-menu-tab-click-refresh', handleSiderMenuRefresh);
    };
  }, [EventEmitter, config.siderKey, loadResources]);

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

  const handleSkillImportClick = () => {
    if (skillUploadInputRef.current) {
      skillUploadInputRef.current.value = '';
    }
    skillUploadInputRef.current?.click();
  };

  const handleSkillImportChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const uploadFiles = Array.from(event.target.files || []).filter(Boolean);
    event.target.value = '';
    if (!uploadFiles.length) {
      return;
    }

    if (
      uploadFiles.some((file) => {
        const fileName = file.name.toLowerCase();
        return !fileName.endsWith('.zip');
      })
    ) {
      message.error(intl.formatMessage({ id: 'resourceTabs.skillUpload.onlyZip' }));
      return;
    }

    const userCode = userInfo?.userCode;
    if (!userCode) {
      message.error(intl.formatMessage({ id: 'resourceTabs.skillUpload.noUserCode' }));
      return;
    }

    setSkillUploading(true);
    try {
      const formData = new FormData();
      uploadFiles.forEach((file) => {
        formData.append('files', file);
      });
      formData.append('userCode', userCode);
      if (activeSiderAgent.resourceId) {
        formData.append('resourceId', String(activeSiderAgent.resourceId));
      }

      const response = await uploadSkillZip(formData);
      message.success(response?.msg || intl.formatMessage({ id: 'resourceTabs.skillUpload.success' }));
      EventEmitter.emit('beyond-resourceList-resourceType-reload', 'SKILL');
    } catch (error: any) {
      message.error(error?.message || error || intl.formatMessage({ id: 'resourceTabs.skillUpload.failed' }));
    } finally {
      setSkillUploading(false);
    }
  };

  const handleComplexSkillDevelop = () => {
    message.info(intl.formatMessage({ id: 'resourceTabs.skillUpload.codeAgentDeveloping' }));
  };

  const openManagerMenu = (menu: any) => {
    if (menu?.menuUrl) {
      let url = normalizeMenuUrl(menu.menuUrl);
      if (url.includes('${Beyond-token}')) {
        url = url.replace('${Beyond-token}', getToken());
      }
      window.open(url, '_blank');
      return true;
    }

    const routePath = menu?.routePath || (String(menu?.path || '').startsWith('/manager/') ? menu.path : '');
    if (routePath) {
      window.open(`${window.location.origin}${getRuntimeActualUrl(routePath)}`, '_blank');
      return true;
    }

    return false;
  };

  const handlePageSkillDevelop = async () => {
    try {
      const menus = await getManagerMenuConfig();
      const matchedMenu = menus.find((item: any) => {
        const names = [item.name, item.nameEn, item.menuNameCn, item.menuNameEn].filter(Boolean).map(String);
        return item.menuCode === UI_SKILL_MENU_CODE || names.some((name) => name.includes(UI_SKILL_MENU_NAME));
      });

      if (matchedMenu && openManagerMenu(matchedMenu)) {
        return;
      }

      message.warning(intl.formatMessage({ id: 'resourceTabs.skillUpload.noMenuConfig' }));
    } catch (error: any) {
      message.warning(error?.message || intl.formatMessage({ id: 'resourceTabs.skillUpload.noMenuConfig' }));
    }
  };

  const getResourceIcon = () => {
    if (resourceType === 'TOOL' || resourceType === 'SKILL') return 'icon-chajiantubiao';
    return 'icon-chuangjianfangshi-shujuku';
  };

  const getResourceName = (resourceBizType?: string) => {
    if (resourceBizType === ResourceTypeMap.TOOL || resourceBizType === resourceBizTypeMap.TOOL) {
      return intl.formatMessage({ id: 'resource.tool' });
    }
    if (resourceBizType === ResourceTypeMap.VIEW) return intl.formatMessage({ id: 'resource.view' });
    if (resourceBizType === ResourceTypeMap.OBJECT) return intl.formatMessage({ id: 'resource.object' });
    if (resourceBizType === ResourceTypeMap.SKILL) return intl.formatMessage({ id: 'common.skill' });
    if (resourceBizType === PROPERTY_RESOURCE_TYPE) return intl.formatMessage({ id: 'resource.property' });
    if (
      resourceBizType &&
      [resourceBizTypeMap.KG_DOC, resourceBizTypeMap.KG_QA, resourceBizTypeMap.KG_TERM].includes(resourceBizType)
    ) {
      return intl.formatMessage({ id: 'resource.knowledge' });
    }
    return intl.formatMessage({ id: 'resource.default' });
  };

  const renderSkillSourceTag = (item: ResourceItem) => {
    if (resourceType !== 'SKILL' || item.displaySourceType !== SKILL_DISPLAY_SOURCE_USER_DEVELOPED) {
      return null;
    }

    return (
      <span className={styles.skillSourceTag}>
        <span className={styles.skillSourceTagText}>
          {intl.formatMessage({ id: 'resource.skillSource.userDeveloped' })}
        </span>
      </span>
    );
  };

  const openShareAuthModal = async (item: ResourceItem) => {
    if (!item.resourceId || !item.resourceBizType) return;
    try {
      const detail = (await listAuthDetail({
        grantType: SHARE_GRANT_TYPE,
        grantObjType: item.resourceBizType,
        grantObjId: item.resourceId,
      })) as unknown as AuthDetailResponse;

      if (detail && detail.code === 0) {
        setShareRecord(item);
        setShareAuthList(detail.data?.redList?.map(getGrantItem) || []);
        setShareBlackList(detail.data?.blackList?.map(getGrantItem) || []);
        setShareModalOpen(true);
        return;
      }

      message.error(detail?.msg || intl.formatMessage({ id: 'common.operationFailed' }));
    } catch (error: any) {
      message.error(error?.message || intl.formatMessage({ id: 'common.operationFailed' }));
    }
  };

  // 当前用户对该数字员工是否有管理权限，无则隐藏技能卸载入口（后端同样校验）。
  const canManageActiveAgent = useDigitalEmployeeManagePermission(
    resourceType === 'SKILL' ? activeSiderAgent.resourceId : undefined
  );

  // 工作空间(用户开发)技能的详情 / 分享(资源化) 复用公共 hook，保证与右侧个人技能 tab 行为一致。
  // 卸载仍走本地 handleUninstallSkill（左侧按数字员工维度，文案为“卸载”）。
  const workspaceActions = useWorkspaceSkillActions({
    resourceId: activeSiderAgent.resourceId,
    agentName: activeSiderAgent.name,
    setDetailPanel,
    clearDetailPanel,
    onShareAuth: (resourceItem) => openShareAuthModal(resourceItem as ResourceItem),
    onChanged: () => {
      EventEmitter.emit('beyond-resourceList-resourceType-reload', 'SKILL');
      if (!isInDrillDown()) {
        loadResources({ reset: true });
      }
    },
  });

  const handleDetail = async (item: ResourceItem) => {
    const { resourceBizType, resourceId } = item;
    const closeDetailPanel = () => clearDetailPanel?.();

    if (resourceBizType === PROPERTY_RESOURCE_TYPE) {
      setDetailPanel?.(<PropertyDetail item={item} onClose={closeDetailPanel} />, { width: 350 });
      return;
    }

    if (resourceBizType === ResourceTypeMap.SKILL) {
      if (isWorkspaceSkill(item)) {
        await workspaceActions.openDetail(item as WorkspaceSkillItem);
        return;
      }
      if (resourceId) {
        setDetailPanel?.(
          <SkillDetailDrawer
            resourceId={String(resourceId)}
            title={intl.formatMessage({ id: 'common.skill' })}
            open
            panel
            onClose={closeDetailPanel}
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
        // ResourceTypeMap.SKILL,
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
            resourceId={String(resourceId)}
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
        resourceName={getResourceName(item.resourceBizType)}
        onCancel={closeDetailPanel}
        onEdit={() => {}}
      />,
      { width: 350 }
    );
  };

  const handleShare = async (item: ResourceItem) => {
    if (!isWorkspaceSkill(item)) {
      await openShareAuthModal(item);
      return;
    }
    // 工作空间技能：资源化 + 冲突确认走公共 hook，资源化成功后由 onShareAuth 回调打开使用授权弹窗。
    await workspaceActions.shareSkill(item as WorkspaceSkillItem);
  };

  const handleShareCancel = () => {
    setShareModalOpen(false);
    setShareRecord(null);
    setShareAuthList([]);
    setShareBlackList([]);
  };

  const handleShareConfirm = async (authList: any[]) => {
    if (!shareRecord?.resourceId || !shareRecord?.resourceBizType) return;

    const redList = authList.map((item) => ({
      ...transformGrantItem(item),
      grantType: SHARE_GRANT_TYPE,
    }));
    const blackList = shareBlackList.map((item) => ({
      ...transformGrantItem(item),
      grantType: SHARE_GRANT_TYPE,
    }));

    try {
      const res = (await batchHandleAuth(
        {
          grantObjId: shareRecord.resourceId,
          grantObjType: shareRecord.resourceBizType,
          redList,
          blackList,
          resourceId: shareRecord.resourceId,
        },
        '/byaiService/auth/privilegeGrant/setResourceUsers'
      )) as unknown as AuthSaveResponse;

      if (res && res.code === 0) {
        message.success(intl.formatMessage({ id: 'common.shareSuccess' }));
        handleShareCancel();
        if (!isInDrillDown()) {
          loadResources({ reset: true });
        }
        return;
      }

      message.error(res?.msg || intl.formatMessage({ id: 'common.shareFailed' }));
    } catch (error: any) {
      message.error(error?.message || intl.formatMessage({ id: 'common.shareFailed' }));
    }
  };

  const handleUninstallSkill = (item: ResourceItem) => {
    if (!activeSiderAgent.resourceId) {
      message.error(intl.formatMessage({ id: 'resource.noDefaultDigitalEmployee' }));
      return;
    }
    const employeeName = activeSiderAgent.name || intl.formatMessage({ id: 'resource.currentDigitalEmployee' });
    const workspaceSkill = isWorkspaceSkill(item);

    Modal.confirm({
      title: intl.formatMessage({ id: 'resource.uninstallSkill' }),
      content: intl.formatMessage(
        {
          id: workspaceSkill ? 'resource.uninstallWorkspaceSkillConfirm' : 'resource.uninstallSkillConfirm',
        },
        { employeeName, skillName: item.resourceName }
      ),
      okText: intl.formatMessage({ id: 'common.confirm' }),
      cancelText: intl.formatMessage({ id: 'common.cancel' }),
      async onOk() {
        try {
          if (workspaceSkill) {
            if (!item.skillPath) {
              message.error(intl.formatMessage({ id: 'resource.skillDownload.noSkillPath' }));
              return;
            }
            await deleteSkill({
              skillPath: item.skillPath,
              resourceId: activeSiderAgent.resourceId,
              userCode: userInfo?.userCode,
            });
          } else {
            // uninstallRelResources 走 customHandle，业务失败（如无管理权限 code!==0）也会 resolve，必须显式校验 code。
            const res: any = await uninstallDigitalEmployeeRelResources({
              digitalEmployeeId: activeSiderAgent.resourceId!,
              relIds: [item.resourceId],
            });
            if (res && res.code !== 0) {
              message.error(res.msg || intl.formatMessage({ id: 'common.operationFailed' }));
              return;
            }
          }
          message.success(intl.formatMessage({ id: 'resource.uninstallSuccess' }));
          if (!isInDrillDown()) {
            loadResources({ reset: true });
          }
          EventEmitter.emit('beyond-resourceList-resourceType-reload', 'SKILL');
        } catch (error: any) {
          message.error(error?.message || error || intl.formatMessage({ id: 'common.operationFailed' }));
        }
      },
    });
  };

  /**
   * 渲染资源详情下拉菜单
   */
  const renderDetailDropdown = (item: ResourceItem) => {
    const menuItems: { key: string; label: React.ReactNode }[] = [];
    menuItems.push({
      key: 'detail',
      label: <div className={employeeStyles.dropdownMenuItem}>{intl.formatMessage({ id: 'common.detail' })}</div>,
    });
    if (item.resourceBizType !== PROPERTY_RESOURCE_TYPE) {
      menuItems.push({
        key: 'share',
        label: <div className={employeeStyles.dropdownMenuItem}>{intl.formatMessage({ id: 'common.share' })}</div>,
      });
    }
    if (resourceType === 'SKILL' && item.resourceBizType === ResourceTypeMap.SKILL && canManageActiveAgent) {
      menuItems.push({
        key: 'uninstall',
        label: (
          <div className={employeeStyles.dropdownMenuItem}>{intl.formatMessage({ id: 'resource.uninstallSkill' })}</div>
        ),
      });
    }

    return (
      <Dropdown
        key="detail"
        trigger={['hover']}
        overlayClassName={employeeStyles.mydropdown}
        menu={{
          items: menuItems,
          onClick: ({ key, domEvent }) => {
            domEvent.preventDefault();
            domEvent.stopPropagation();
            if (key === 'share') {
              void handleShare(item);
              return;
            }
            if (key === 'uninstall') {
              handleUninstallSkill(item);
              return;
            }
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
        } else if (item.resourceBizType === PROPERTY_RESOURCE_TYPE) {
          handleDetail(item);
        }
      }, 220);
    },
    [clearItemClickTimer, handleDrillDown, handleDetail]
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
      <div className={styles.searchActionRow}>
        <Input
          className={styles.searchInput}
          value={searchValue}
          suffix={<SearchOutlined onClick={handleSearch} />}
          placeholder={placeholder}
          onChange={(event) => setSearchValue(event.target.value)}
          onPressEnter={handleSearch}
        />
        {resourceType === 'SKILL' && (
          <Button
            size="small"
            className={styles.skillUploadButton}
            icon={<AntdIcon type="icon-a-Uploadshangchuan" />}
            loading={skillUploading}
            disabled={skillUploading}
            onClick={handleSkillImportClick}
          >
            {intl.formatMessage({ id: 'resourceTabs.skillUpload.uploadButton' })}
          </Button>
        )}
      </div>
      {resourceType === 'SKILL' && (
        <>
          <input
            ref={skillUploadInputRef}
            className={styles.skillUploadInput}
            type="file"
            accept=".zip"
            multiple
            onChange={handleSkillImportChange}
          />
          <div className={styles.skillActionBar}>
            <Button
              size="small"
              className={styles.skillActionButton}
              icon={<AntdIcon type="icon-a-changjing-line" />}
              onClick={handleComplexSkillDevelop}
            >
              {intl.formatMessage({ id: 'resourceTabs.skillUpload.complexSkillDevelop' })}
            </Button>
            <Button
              size="small"
              className={styles.skillActionButton}
              icon={<AntdIcon type="icon-a-yemian-line" />}
              onClick={handlePageSkillDevelop}
            >
              {intl.formatMessage({ id: 'resourceTabs.skillUpload.pageSkillDevelop' })}
            </Button>
          </div>
        </>
      )}
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
            const resourceImage = getResourceImageUrl(item);

            return (
              <List.Item
                key={item.resourceId}
                className={styles.resourceItem}
                onClick={() => handleResourceItemClick(item, drillable)}
                onDoubleClick={() => handleResourceItemDoubleClick(item)}
                actions={[renderDetailDropdown(item)]}
              >
                <List.Item.Meta
                  avatar={
                    <span className={styles.resourceAvatar}>
                      {drillable && <AntdIcon type="icon-a-xiangyou" className={styles.drillIcon} />}
                      {resourceType === 'SKILL' && resourceImage ? (
                        <img className={styles.resourceAvatarImage} src={getFileUrl(resourceImage)} alt="" />
                      ) : resourceType === 'SKILL' && item.resourceBizType === ResourceTypeMap.SKILL ? (
                        <span className={styles.skillDefaultAvatar}>
                          <span className={styles.skillDefaultAvatarOrb} />
                        </span>
                      ) : (
                        <AntdIcon
                          type={
                            item.resourceBizType === PROPERTY_RESOURCE_TYPE || String(item.resourceId).includes('-')
                              ? 'icon-a-Database-networkshujukuwangluo'
                              : getResourceIcon()
                          }
                        />
                      )}
                    </span>
                  }
                  title={
                    <Title className={employeeStyles.name}>
                      <Tooltip title={item.resourceName}>
                        <span className={employeeStyles.nameRow}>
                          <span className={employeeStyles.nameText}>{item.resourceName}</span>
                          {renderSkillSourceTag(item)}
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
      {shareModalOpen && (
        <AddAuthModal
          title={intl.formatMessage({ id: 'auth.addAuthObject' })}
          value={shareAuthList}
          showPost={false}
          onCancel={handleShareCancel}
          onOk={handleShareConfirm}
        />
      )}
    </div>
  );
};

export default ResourceSiderPanel;
