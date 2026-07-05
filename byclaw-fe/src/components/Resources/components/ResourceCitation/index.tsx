import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Spin, Modal, Checkbox, Button, List, Tabs, Input, message, Empty, Tooltip, Dropdown } from 'antd';
import { useIntl, useSelector } from '@umijs/max';
import { debounce, trim } from 'lodash';
import classnames from 'classnames';
import AntdIcon from '@/components/AntdIcon';
import withDrag, { DragType } from '@/components/QueryInput/withDrag';
import { ResourceTypeMap } from '@/constants/resource';
import { getResourceImageUrl } from '@/layout/sider/components/ResourceSiderPanel/ResourceSiderListItem';
import { getFileUrl } from '@/utils/file';
import styles from './index.module.less';
import employeeStyles from '@/layout/sider/components/EmployeeList/index.module.less';
// import Empty from '@/components/Empty';
import {
  listResourceUseAuth,
  deleteResource,
  queryDigEmployeeRelResourceAuth,
  queryResourceMembers,
  qryByClawFileByUserCode,
  queryWorkspaceSkillList,
  readFile,
  downloadSkillZip,
} from '@/pages/manager/service/resources';
import { mapWorkspaceSkillRows, isWorkspaceSkill } from '@/components/Resources/workspaceSkill/utils';
import useGlobal from '@/hooks/useGlobal';

const Draggable = withDrag(DragType.tool);
const { TabPane } = Tabs;

interface IResourceItem {
  resourceId: string;
  resourceName: string;
  resourceDesc: string;
  resourceLogoUrl?: string;
  resourceType: React.Key;
  resourceSourcePkId: string;
  resourceBizType: string;
  isTop: string;
  createTime: string;
  extInfo?: {
    targetContent?: string;
  };
  objectKey?: string;
  isFromResourceModule?: boolean;
  skillPath?: string;
  skillUrl?: string;
}

interface Props {
  resourceType: 'TOOL' | 'VIEW' | 'OBJECT' | 'KNOWLEDGE' | 'SPACE' | 'SKILL';
  onSelect?: (item: IResourceItem) => void;
  style?: React.CSSProperties;
  showDefaultTools?: boolean;
  keyword?: string;
  agentId?: string;
  agentIds?: string;
  resourceBizTypeList?: string[];
  disableClick?: boolean;
  ownerType?: string;
  resources?: IResourceItem[];
  loadingOverride?: boolean;

  /** 渲染形态：grid（默认，卡片网格）或 list（列表，用于小面板弹窗） */
  layout?: 'grid' | 'list';
}

const ResourceList = (props: Props) => {
  const {
    resourceType,
    onSelect,
    style,
    showDefaultTools,
    keyword,
    resourceBizTypeList,
    disableClick,
    ownerType,
    agentId,
    resources,
    loadingOverride,
    layout = 'grid',
  } = props;

  const { EventEmitter, sessionId } = useGlobal();

  const normalizedAgentId = useMemo(() => {
    if (!agentId) return agentId;
    return agentId.split('_').pop() || agentId;
  }, [agentId]);

  const searchValue = useRef('');
  const [loading, setLoading] = useState(false);
  const [resourceList, setResourceList] = useState<IResourceItem[]>([]);
  const [pageIndex, setPageIndex] = useState(1);
  const [showPropertiesModal, setShowPropertiesModal] = useState(false);
  const [selectedProperties, setSelectedProperties] = useState<string[]>([]);
  const [currentResource, setCurrentResource] = useState<IResourceItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [activeTabKey, setActiveTabKey] = useState<string>('');
  const [selectAll, setSelectAll] = useState(false);
  const [selectAllIndeterminate, setSelectAllIndeterminate] = useState(false);
  const [selectedRelatedObject, setSelectedRelatedObject] = useState<any>(null);
  const [relatedObjectDetailMap, setRelatedObjectDetailMap] = useState<Record<string, any>>({});
  const [relatedObjectLoading, setRelatedObjectLoading] = useState(false);
  const [downloadingSkill, setDownloadingSkill] = useState<string | null>(null);
  const [deletingSkill, setDeletingSkill] = useState<string | null>(null);
  const [failedResourceImageUrls, setFailedResourceImageUrls] = useState<Set<string>>(() => new Set());

  const intl = useIntl();
  const { userInfo } = useSelector((state: any) => state.user);

  const lockBizTypes = resourceBizTypeList && resourceBizTypeList.length > 0;

  const defaultResources = useMemo(() => {
    if (showDefaultTools && !lockBizTypes && resourceType === 'TOOL') {
      return [
        {
          resourceName: intl.formatMessage({ id: 'thinkTitle.networkSearch' }),
          resourceId: 'NetworkSearch',
          resourceType: 'TOOL',
          resourceSourcePkId: '',
          resourceBizType: 'TOOL',
          resourceDesc: '',
          isTop: '0',
          createTime: '',
        },
        {
          resourceName: intl.formatMessage({ id: 'thinkTitle.companyData' }),
          resourceId: 'CompanyInfo',
          resourceType: 'TOOL',
          resourceSourcePkId: '',
          resourceBizType: 'TOOL',
          resourceDesc: '',
          isTop: '0',
          createTime: '',
        },
      ];
    }
    return [];
  }, [showDefaultTools, lockBizTypes, resourceType, intl]);

  const sharedDisplayResources = useMemo(() => {
    if (!resources) {
      return null;
    }
    const normalizedKeyword = trim(keyword || '').toLowerCase();
    const baseResources = [...defaultResources, ...(resources || [])];
    if (!normalizedKeyword) {
      return baseResources;
    }
    return baseResources.filter((item) => {
      const resourceName = `${item.resourceName || ''}`.toLowerCase();
      const resourceDesc = `${item.resourceDesc || ''}`.toLowerCase();
      return resourceName.includes(normalizedKeyword) || resourceDesc.includes(normalizedKeyword);
    });
  }, [defaultResources, keyword, resourceType, resources]);

  const pageSize = 100;
  const loadResources = async (reset = false, myResourceType: string = resourceType) => {
    if (resources) {
      return;
    }
    if (loading) return;
    if (reset) {
      setLoading(true);
    }

    try {
      let rows: any[] = [];
      const currentResourceBizTypeList =
        Array.isArray(resourceBizTypeList) && resourceBizTypeList.length
          ? resourceBizTypeList
          : myResourceType === 'SKILL'
            ? ['SKILL']
            : resourceBizTypeList;

      // 当 resourceType 为 SPACE 时，使用新的接口
      if (myResourceType === 'SPACE') {
        if (sessionId) {
          const response = await qryByClawFileByUserCode({
            userCode: userInfo?.userCode,
            keyword: searchValue.current.trim(),
            sessionId,
          });
          const dataList = Array.isArray(response) ? response : [];
          // 将返回的数据映射为组件需要的格式
          rows = dataList.map((item: any, index: number) => ({
            ...item,
            resourceId: item.objectKey || index,
            resourceName: item.fileName,
            resourceDesc: item.objectKey,
          }));
        }
      } else {
        const currentPage = reset ? 1 : pageIndex;
        if (normalizedAgentId) {
          const response = await queryDigEmployeeRelResourceAuth({
            resourceId: normalizedAgentId,
            pageSize,
            pageNum: currentPage,
            keyword: searchValue.current.trim(),
            resourceBizTypeList: currentResourceBizTypeList,
          });
          const allRows = Array.isArray(response?.rows)
            ? response.rows
            : Array.isArray(response?.list)
              ? response.list
              : [];
          rows =
            Array.isArray(currentResourceBizTypeList) && currentResourceBizTypeList.length
              ? allRows.filter((item: any) => currentResourceBizTypeList.includes(item.resourceBizType))
              : allRows;
          // 与左侧“技能中心”同口径：技能 tab 首屏在“已绑定技能”之外，合并“用户开发（工作空间未绑定）”技能。
          if (myResourceType === 'SKILL' && reset) {
            try {
              const workspaceSkillResponse: any = await queryWorkspaceSkillList({
                resourceId: normalizedAgentId,
                userCode: userInfo?.userCode,
                keyword: searchValue.current.trim(),
              });
              const workspaceRaw = Array.isArray(workspaceSkillResponse)
                ? workspaceSkillResponse
                : Array.isArray(workspaceSkillResponse?.data)
                  ? workspaceSkillResponse.data
                  : Array.isArray(workspaceSkillResponse?.rows)
                    ? workspaceSkillResponse.rows
                    : Array.isArray(workspaceSkillResponse?.list)
                      ? workspaceSkillResponse.list
                      : [];
              rows = [...rows, ...mapWorkspaceSkillRows(workspaceRaw)];
            } catch (error) {
              console.warn('query workspace skills failed', error);
            }
          }
        } else {
          const response = await listResourceUseAuth({
            pageSize,
            pageNum: currentPage,
            keyword: searchValue.current.trim(),
            resourceBizTypeList: currentResourceBizTypeList,
            ownerType,
            resourceId: normalizedAgentId,
          });
          rows = Array.isArray(response?.rows) ? response.rows : Array.isArray(response?.list) ? response.list : [];
        }
      }

      if (reset) {
        setResourceList([...defaultResources, ...rows]);
      } else {
        setResourceList((prev) => [...defaultResources, ...prev, ...rows]);
      }
      setPageIndex(pageIndex + 1);
    } catch (error) {
      console.error('Failed to load resources:', error);
    } finally {
      setLoading(false);
    }
  };

  // 初始加载
  useEffect(() => {
    if (resources) {
      return;
    }
    loadResources(true);
  }, [lockBizTypes, resourceBizTypeList?.join(','), sessionId, resources]);

  useEffect(() => {
    if (!resources) {
      return;
    }
    setResourceList(sharedDisplayResources || []);
    setPageIndex(1);
  }, [sharedDisplayResources, resources]);

  useEffect(() => {
    if (!resources) {
      return;
    }
    setLoading(!!loadingOverride);
  }, [loadingOverride, resources]);

  const onKeywordChanged = debounce((keyword: string) => {
    searchValue.current = keyword;
    loadResources(true);
  }, 200);

  // 用于跟踪是否是首次渲染
  const isFirstRender = useRef(true);

  const getRelatedObjectKey = (object: any) => {
    if (!object) return '';
    return `${object.resourceId || object.resourceCode || object.resourceName || ''}`;
  };

  const getRelatedObjectFieldKey = (object: any, field: any, index: number) => {
    return `objectField_${getRelatedObjectKey(object)}_${field?.propertyCode || index}`;
  };

  const getRelatedObjectCitationKey = (object: any, index: number) => {
    return `object_${getRelatedObjectKey(object) || index}`;
  };

  useEffect(() => {
    if (keyword !== undefined) {
      searchValue.current = keyword;
      if (resources) {
        setResourceList(sharedDisplayResources || []);
        return;
      }
      // 避免在首次渲染时与初始加载的 useEffect 重复调用
      if (!resources && !isFirstRender.current) {
        onKeywordChanged(keyword);
      }
      // 首次渲染后设置为 false
      isFirstRender.current = false;
    }
  }, [keyword, resources, resourceType, sharedDisplayResources]);

  // 当标签页切换或搜索关键字变化时，更新全选状态
  useEffect(() => {
    if (currentResource?.extInfo?.targetContent) {
      try {
        const targetContent = JSON.parse(currentResource.extInfo.targetContent);
        const selectedRelatedObjectKey = getRelatedObjectKey(selectedRelatedObject);
        const relatedObjectDetail = selectedRelatedObjectKey ? relatedObjectDetailMap[selectedRelatedObjectKey] : null;
        const relatedObjectTargetContent = relatedObjectDetail?.extInfo?.targetContent
          ? JSON.parse(relatedObjectDetail.extInfo.targetContent)
          : null;
        const currentType = activeTabKey === 'objects' ? 'objectField' : 'field';
        const items = currentType === 'objectField' ? relatedObjectTargetContent?.fields : targetContent.fields;

        if (items && items.length > 0) {
          const filteredItems = items.filter((item: any) => {
            const keyword = searchKeyword.toLowerCase();
            return item.propertyName && item.propertyName.toLowerCase().includes(keyword);
          });

          const allIds = filteredItems.map((item: any, index: number) =>
            currentType === 'objectField'
              ? getRelatedObjectFieldKey(selectedRelatedObject, item, index)
              : `field_${item.propertyCode || index}`
          );

          const selectedCount = selectedProperties.filter((id) => allIds.includes(id)).length;

          if (selectedCount === 0) {
            setSelectAll(false);
            setSelectAllIndeterminate(false);
          } else if (selectedCount === allIds.length) {
            setSelectAll(true);
            setSelectAllIndeterminate(false);
          } else {
            setSelectAll(false);
            setSelectAllIndeterminate(true);
          }
        }
      } catch (error) {
        console.error('Error parsing targetContent:', error);
      }
    }
  }, [activeTabKey, searchKeyword, currentResource, selectedProperties, selectedRelatedObject, relatedObjectDetailMap]);

  // 根据资源类型获取图标
  const getResourceIcon = (resourceName: string) => {
    const normalizedName = `${resourceName || ''}`.toLowerCase();

    switch (resourceType) {
      case 'TOOL':
      case 'SKILL':
        return 'icon-chajiantubiao';
      case 'VIEW':
        return 'icon-chuangjianfangshi-shujuku';
      case 'OBJECT':
        return 'icon-chuangjianfangshi-shujuku';
      case 'SPACE':
        if (normalizedName.endsWith('.csv')) {
          return 'icon-CSV';
        }
        if (normalizedName.endsWith('.pdf')) {
          return 'icon-PDF';
        }
        if (/\.(doc|docx|docs)$/.test(normalizedName)) {
          return 'icon-Word';
        }
        if (/\.(png|jpg|jpeg|gif|webp|bmp|tif|tiff|svg|ico|heic)$/.test(normalizedName)) {
          return 'icon-Image';
        }
        if (normalizedName.endsWith('.txt')) {
          return 'icon-jishiben';
        }
        if (normalizedName.endsWith('.json')) {
          return 'icon-json';
        }
        if (normalizedName.endsWith('.java')) {
          return 'icon-Java';
        }
        if (normalizedName.endsWith('.sql')) {
          return 'icon-sql1';
        }
        if (normalizedName.endsWith('.html')) {
          return 'icon-html';
        }
        if (/\.(xls|xlsx)$/.test(normalizedName)) {
          return 'icon-Excel';
        }
        if (/\.(ppt|pptx|pptm)$/.test(normalizedName)) {
          return 'icon-PPT';
        }
        if (/\.(md|markdown)$/.test(normalizedName)) {
          return 'icon-markdown';
        }
        return 'icon-chuangjianfangshi-wendangku';
      default:
        return 'icon-chuangjianfangshi-wendangku';
    }
  };

  const renderCompactAvatar = (item: IResourceItem) => {
    const resourceImage = getResourceImageUrl(item);
    const resourceImageUrl = resourceImage ? getFileUrl(resourceImage) : '';
    const imageLoadFailed = resourceImageUrl ? failedResourceImageUrls.has(resourceImageUrl) : false;

    if (resourceType === 'SKILL' && resourceImageUrl && !imageLoadFailed) {
      return (
        <img
          key={resourceImageUrl}
          className={styles.compactAvatarImage}
          src={resourceImageUrl}
          alt=""
          fetchPriority="low"
          onError={() => {
            setFailedResourceImageUrls((prev) => {
              if (prev.has(resourceImageUrl)) {
                return prev;
              }
              const next = new Set(prev);
              next.add(resourceImageUrl);
              return next;
            });
          }}
        />
      );
    }

    if (resourceType === 'SKILL' && (item.resourceBizType === ResourceTypeMap.SKILL || imageLoadFailed)) {
      return (
        <span className={styles.skillDefaultAvatar}>
          <span className={styles.skillDefaultAvatarOrb} />
        </span>
      );
    }

    return <AntdIcon type={getResourceIcon(item.resourceName)} className={styles.defaultLogoIcon} />;
  };

  // 处理技能下载（带防抖）
  const handleDownloadSkill = useMemo(() => {
    const download = async (item: IResourceItem) => {
      // 资源化（已绑定）技能与用户开发（工作空间未绑定）技能的存储路径命名空间不同：
      // - 资源化技能：按 skillId 走资源包下载；
      // - 工作空间技能：按 skillPath 打包 /.openclaw/workspace-baiying-agent-{resourceId}/skills 下的目录。
      // 不能都塞进 skillPath，否则工作空间技能会命中资源下载校验而报错。
      const workspace = isWorkspaceSkill(item as any);
      if (workspace ? !item.skillPath : !item.resourceId) {
        message.error(intl.formatMessage({ id: 'resource.skillDownload.noSkillPath' }));
        return;
      }
      setDownloadingSkill(`${workspace ? item.skillPath : item.resourceId}`);

      try {
        const params: {
          skillPath?: string;
          skillId?: string | number;
          resourceId?: string | number;
          userCode?: string;
        } = workspace
          ? {
            skillPath: item.skillPath as string,
            ...(normalizedAgentId ? { resourceId: normalizedAgentId } : {}),
            ...(userInfo?.userCode ? { userCode: userInfo.userCode } : {}),
          }
          : { skillId: item.resourceId };

        const response = await downloadSkillZip(params);

        // request.ts 在 responseType=blob 时统一封装成 { fileName, file }；这里只用 file 字段构造 Blob，
        // 直接 new Blob([response]) 会把整个对象当字符串塞进去（变成 "[object Object]"），导致下载文件无法解压。
        const fileBlob = response?.file;
        if (fileBlob) {
          const blob = fileBlob instanceof Blob ? fileBlob : new Blob([fileBlob], { type: 'application/zip' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = response?.fileName || `${item.resourceName || 'skill'}.zip`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } else {
          message.error(intl.formatMessage({ id: 'resource.skillDownload.failed' }));
        }
      } catch (error) {
        console.error('技能下载失败：', error);
        message.error(intl.formatMessage({ id: 'resource.skillDownload.failed' }));
      } finally {
        setDownloadingSkill(null);
      }
    };

    return debounce(download, 500, { leading: true, trailing: false });
  }, [userInfo, normalizedAgentId, intl]);

  const handleRelatedObjectClick = async (object: any, forceRefresh = false) => {
    const objectKey = getRelatedObjectKey(object);
    setSelectedRelatedObject(object);
    setSelectAll(false);
    setSelectAllIndeterminate(false);

    if (!objectKey || (!forceRefresh && relatedObjectDetailMap[objectKey])) {
      return;
    }

    setRelatedObjectLoading(true);
    try {
      const data = await queryResourceMembers({ resourceId: object.resourceId || object.resourceCode });
      setRelatedObjectDetailMap((prev) => ({
        ...prev,
        [objectKey]: data,
      }));
    } catch (error) {
      console.error('Error fetching related object detail:', error);
    } finally {
      setRelatedObjectLoading(false);
    }
  };

  const handleDeleteSkill = async (item: IResourceItem) => {
    const resourceId = item.resourceId;
    if (!resourceId) {
      message.error(intl.formatMessage({ id: 'common.deleteFail' }));
      return;
    }
    setDeletingSkill(resourceId);
    try {
      await deleteResource({ resourceId });
      setResourceList((prev) => prev.filter((resource) => resource.resourceId !== resourceId));
      message.success(intl.formatMessage({ id: 'common.deleteSuccess' }));
      EventEmitter.emit('beyond-resourceList-resourceType-reload', 'SKILL');
    } catch (error) {
      console.error('技能删除失败：', error);
      message.error(intl.formatMessage({ id: 'common.deleteFailed' }));
    } finally {
      setDeletingSkill(null);
    }
  };

  // 处理更多按钮点击
  const handleMoreClick = async (e: React.MouseEvent, item: IResourceItem) => {
    e.stopPropagation(); // 阻止冒泡，避免触发卡片点击
    // 立即设置当前资源并打开面板
    setCurrentResource(item);
    setSelectedProperties([]);
    setSearchKeyword('');
    setActiveTabKey('');
    setSelectAll(false);
    setSelectAllIndeterminate(false);
    setSelectedRelatedObject(null);
    setRelatedObjectDetailMap({});
    setRelatedObjectLoading(false);
    setShowPropertiesModal(true);
    setDetailLoading(true);
    try {
      // 后台异步调用详情接口查询数据
      const data = await queryResourceMembers({ resourceId: item.resourceId });
      setCurrentResource({
        ...item,
        ...data,
      });
      const targetContent = data?.extInfo?.targetContent ? JSON.parse(data.extInfo.targetContent) : null;
      if (targetContent?.objects?.length) {
        handleRelatedObjectClick(targetContent.objects[0], true);
      }
    } catch (error) {
      console.error('Error fetching resource detail:', error);
      // 如果接口调用失败，保持原来的item数据
    } finally {
      setDetailLoading(false);
    }
  };

  // 处理属性选择
  const handlePropertyChange = (propertyId: string, checked: boolean) => {
    let newSelectedProperties;
    if (checked) {
      newSelectedProperties = [...selectedProperties, propertyId];
    } else {
      newSelectedProperties = selectedProperties.filter((id) => id !== propertyId);
    }
    setSelectedProperties(newSelectedProperties);

    // 更新全选状态
    if (currentResource?.extInfo?.targetContent) {
      try {
        const targetContent = JSON.parse(currentResource.extInfo.targetContent);
        const selectedRelatedObjectKey = getRelatedObjectKey(selectedRelatedObject);
        const relatedObjectDetail = selectedRelatedObjectKey ? relatedObjectDetailMap[selectedRelatedObjectKey] : null;
        const relatedObjectTargetContent = relatedObjectDetail?.extInfo?.targetContent
          ? JSON.parse(relatedObjectDetail.extInfo.targetContent)
          : null;
        const currentType = activeTabKey === 'objects' ? 'objectField' : 'field';
        const items = currentType === 'objectField' ? relatedObjectTargetContent?.fields : targetContent.fields;

        if (items && items.length > 0) {
          const filteredItems = items.filter((item: any) => {
            const keyword = searchKeyword.toLowerCase();
            return item.propertyName && item.propertyName.toLowerCase().includes(keyword);
          });

          const allIds = filteredItems.map((item: any, index: number) =>
            currentType === 'objectField'
              ? getRelatedObjectFieldKey(selectedRelatedObject, item, index)
              : `field_${item.propertyCode || index}`
          );

          const selectedCount = newSelectedProperties.filter((id) => allIds.includes(id)).length;

          if (selectedCount === 0) {
            setSelectAll(false);
            setSelectAllIndeterminate(false);
          } else if (selectedCount === allIds.length) {
            setSelectAll(true);
            setSelectAllIndeterminate(false);
          } else {
            setSelectAll(false);
            setSelectAllIndeterminate(true);
          }
        }
      } catch (error) {
        console.error('Error parsing targetContent:', error);
      }
    }
  };

  // 处理全选
  const handleSelectAll = (checked: boolean, type: 'object' | 'field') => {
    setSelectAll(checked);
    setSelectAllIndeterminate(false);
    if (currentResource?.extInfo?.targetContent) {
      try {
        const targetContent = JSON.parse(currentResource.extInfo.targetContent);
        const selectedRelatedObjectKey = getRelatedObjectKey(selectedRelatedObject);
        const relatedObjectDetail = selectedRelatedObjectKey ? relatedObjectDetailMap[selectedRelatedObjectKey] : null;
        const relatedObjectTargetContent = relatedObjectDetail?.extInfo?.targetContent
          ? JSON.parse(relatedObjectDetail.extInfo.targetContent)
          : null;
        const filteredItems =
          type === 'object'
            ? relatedObjectTargetContent?.fields?.filter((item: any) => {
              const keyword = searchKeyword.toLowerCase();
              return item.propertyName && item.propertyName.toLowerCase().includes(keyword);
            }) || []
            : targetContent.fields?.filter((item: any) => {
              const keyword = searchKeyword.toLowerCase();
              return item.propertyName && item.propertyName.toLowerCase().includes(keyword);
            }) || [];

        if (checked) {
          const allIds = filteredItems.map((item: any, index: number) =>
            type === 'object'
              ? getRelatedObjectFieldKey(selectedRelatedObject, item, index)
              : `field_${item.propertyCode || index}`
          );
          setSelectedProperties([
            ...selectedProperties,
            ...allIds.filter((id: string) => !selectedProperties.includes(id)),
          ]);
        } else {
          const toRemove = filteredItems.map((item: any, index: number) =>
            type === 'object'
              ? getRelatedObjectFieldKey(selectedRelatedObject, item, index)
              : `field_${item.propertyCode || index}`
          );
          setSelectedProperties(selectedProperties.filter((id) => !toRemove.includes(id)));
        }
      } catch (error) {
        console.error('Error parsing targetContent:', error);
      }
    }
  };

  // 处理确定按钮点击
  const handleConfirmProperties = () => {
    if (currentResource && selectedProperties.length > 0) {
      try {
        const targetContent = currentResource?.extInfo?.targetContent
          ? JSON.parse(currentResource.extInfo.targetContent)
          : null;

        // 收集选中的对象和属性
        const selectedItems: string[] = [];

        // 处理选中的关联对象属性
        if (targetContent?.objects) {
          targetContent.objects.forEach((object: any, index: number) => {
            if (selectedProperties.includes(getRelatedObjectCitationKey(object, index))) {
              selectedItems.push(`${object.resourceName}`);
            }

            const objectKey = getRelatedObjectKey(object);
            const objectDetail = objectKey ? relatedObjectDetailMap[objectKey] : null;
            const objectTargetContent = objectDetail?.extInfo?.targetContent
              ? JSON.parse(objectDetail.extInfo.targetContent)
              : null;
            objectTargetContent?.fields?.forEach((field: any, fieldIndex: number) => {
              if (selectedProperties.includes(getRelatedObjectFieldKey(object, field, fieldIndex))) {
                selectedItems.push(`${field.propertyName}`);
              }
            });
          });
        }

        // 处理选中的属性
        if (targetContent?.fields) {
          targetContent.fields.forEach((field: any, index: number) => {
            if (selectedProperties.includes(`field_${field.propertyCode || index}`)) {
              selectedItems.push(`${field.propertyName}`);
            }
          });
        }

        // 构建选中值字符串
        const propsString = selectedItems.join(', ');

        // 调用onSelect回调，将选中值字符串传递给父组件
        if (onSelect && !disableClick) {
          onSelect({
            ...currentResource,
            resourceName: propsString,
            isFromResourceModule: true,
          });
        }

        // 关闭模态框
        setShowPropertiesModal(false);
      } catch (error) {
        console.error('处理属性选择时出错:', error);
        // 关闭模态框
        setShowPropertiesModal(false);
      }
    }
  };

  // 获取资源业务类型标签文本
  const getResourceBizTypeTagText = (resourceBizType: string): string | undefined => {
    const tagMap: Record<string, string> = {
      MCP: 'resource.mcp',
      TOOLKIT: 'resource.toolkit',
      AGENT: 'resource.agent',
    };
    const tagId = tagMap[resourceBizType];
    if (tagId) {
      return intl.formatMessage({ id: tagId });
    }
    return undefined;
  };

  // 渲染资源业务类型标签
  const renderResourceBizTypeTag = (resourceBizType: string): React.ReactNode => {
    const tagText = getResourceBizTypeTagText(resourceBizType);
    if (!tagText) return null;
    return (
      <span className={styles.topRightTag}>
        <span className={styles.topRightTagText}>{tagText}</span>
      </span>
    );
  };

  // 渲染卡片/列表项的操作下拉菜单（详情 / 下载 / 删除）
  const renderActionDropdown = (item: IResourceItem, variant: 'grid' | 'list' = 'grid'): React.ReactNode => {
    if (resourceType !== 'OBJECT' && resourceType !== 'VIEW' && resourceType !== 'SPACE' && resourceType !== 'SKILL') {
      return null;
    }
    return (
      <Dropdown
        trigger={variant === 'list' ? ['hover'] : undefined}
        menu={{
          onClick: ({ domEvent }) => {
            domEvent.stopPropagation();
          },
          items: [
            ...(resourceType === 'OBJECT' || resourceType === 'VIEW'
              ? [
                {
                  key: 'detail',
                  label: intl.formatMessage({ id: 'common.detail' }),
                  onClick: () => handleMoreClick({ stopPropagation: () => {} } as React.MouseEvent, item),
                },
              ]
              : []),
            ...(resourceType === 'SPACE'
              ? [
                {
                  key: 'download',
                  label: intl.formatMessage({ id: 'common.download' }),
                  onClick: async () => {
                    try {
                      const userCode = userInfo?.userCode || '3174953401447148';
                      const parts = item.objectKey?.split('/') || [];
                      const sessionId = parts.length >= 2 ? parts[2] : '10026200';
                      const filePath = item.resourceName || '';

                      const response = await readFile({
                        userCode,
                        sessionId,
                        filePath,
                        begin_line: 0,
                        end_line: -1,
                        objectKey: item.objectKey || '',
                      });

                      if (response?.file) {
                        const blob = new Blob([response.file], { type: 'text/plain' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = item.resourceName || 'file.md';
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                      } else {
                        message.error(intl.formatMessage({ id: 'resource.downloadFailedNoContent' }));
                      }
                    } catch (error) {
                      console.error('下载失败：', error);
                      message.error(intl.formatMessage({ id: 'resource.downloadFailedRetry' }));
                    }
                  },
                },
              ]
              : []),
            ...(resourceType === 'SKILL'
              ? [
                {
                  key: 'download',
                  label: intl.formatMessage({ id: 'common.download' }),
                  onClick: () => handleDownloadSkill(item),
                  disabled: !!deletingSkill,
                },
                {
                  key: 'delete',
                  label: intl.formatMessage({ id: 'common.delete' }),
                  onClick: () => handleDeleteSkill(item),
                  disabled: !!downloadingSkill,
                  danger: true,
                },
              ]
              : []),
          ],
        }}
        placement="bottomRight"
      >
        {variant === 'list' ? (
          <span
            className={styles.compactActionTrigger}
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <AntdIcon type="icon-a-Moregengduo" />
          </span>
        ) : (
          <Button
            className={classnames(styles.skillPosterActionBtn, styles.cardActionBtnWrapper)}
            icon={<AntdIcon type="icon-a-Moregengduo" className={styles.cardActionBtnIcon} />}
            onClick={(event) => {
              event.stopPropagation();
            }}
          />
        )}
      </Dropdown>
    );
  };

  useEffect(() => {
    const reload = (resourceType: string) => {
      loadResources(true, resourceType);
    };

    EventEmitter.on('beyond-resourceList-resourceType-reload', reload);

    return () => {
      EventEmitter.off('beyond-resourceList-resourceType-reload', reload);
    };
  }, [EventEmitter, loadResources]);

  return (
    <div className={styles.container} style={style}>
      {layout === 'list' ? (
        loading ? (
          <div className={classnames('ub ub-ac ub-pc', styles.compactStateWrap)}>
            <Spin />
          </div>
        ) : resourceList.length === 0 ? (
          <div className={classnames('ub ub-ac ub-pc', styles.compactStateWrap)}>
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
          </div>
        ) : (
          <List
            className={classnames(employeeStyles.employeesList, styles.compactList)}
            dataSource={resourceList}
            split={false}
            renderItem={(item) => (
              <Draggable key={item.resourceId} data={item} disabled={disableClick}>
                <List.Item
                  className={classnames(styles.compactListItem, { [styles.disabledCard]: disableClick })}
                  onClick={disableClick ? undefined : () => onSelect?.({ ...item, isFromResourceModule: true })}
                >
                  <List.Item.Meta
                    avatar={<span className={styles.compactAvatar}>{renderCompactAvatar(item)}</span>}
                    title={
                      <span className={styles.compactTitleRow}>
                        <span className={styles.nameText}>{item.resourceName}</span>
                        {renderResourceBizTypeTag(item.resourceBizType)}
                      </span>
                    }
                    description={
                      item.resourceDesc ? <span className={styles.compactDesc}>{item.resourceDesc}</span> : null
                    }
                  />
                  <span className={styles.compactActionWrapper}>{renderActionDropdown(item, 'list')}</span>
                </List.Item>
              </Draggable>
            )}
          />
        )
      ) : (
        <div className={styles.cardGrid} id={`${resourceType}ListScroller`}>
          {resourceList.map((item) => (
            <Draggable key={item.resourceId} data={item} disabled={disableClick}>
              <div
                className={classnames(styles.card, { [styles.disabledCard]: disableClick })}
                onClick={disableClick ? undefined : () => onSelect?.({ ...item, isFromResourceModule: true })}
              >
                <div className={styles.cardHeader}>
                  <div className={styles.defaultLogo}>
                    <AntdIcon type={getResourceIcon(item.resourceName)} className={styles.defaultLogoIcon} />
                  </div>
                  <Tooltip title={item.resourceName} placement="bottom">
                    <div className={styles.title}>{item.resourceName}</div>
                  </Tooltip>
                  {/* 标签 */}
                  {renderResourceBizTypeTag(item.resourceBizType)}
                  {renderActionDropdown(item)}
                </div>
                <Tooltip title={item.resourceDesc} placement="bottom">
                  <div className={styles.desc}>{item.resourceDesc}</div>
                </Tooltip>
              </div>
            </Draggable>
          ))}
        </div>
      )}
      {layout !== 'list' && loading && (
        <div className={classnames('ub ub-ac ub-pc', styles.loadingContainer)}>
          <Spin />
        </div>
      )}
      {layout !== 'list' && !loading && resourceList.length === 0 && (
        <div className={styles.emptyContainer}>
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
        </div>
      )}

      {/* 属性信息列表模态框 */}
      <Modal
        title={currentResource?.resourceName || intl.formatMessage({ id: 'resource.propertyInfo' })}
        open={showPropertiesModal}
        onCancel={() => setShowPropertiesModal(false)}
        width={1000}
        footer={[
          <Button key="cancel" onClick={() => setShowPropertiesModal(false)}>
            {intl.formatMessage({ id: 'common.cancel' })}
          </Button>,
          <Button
            key="confirm"
            type="primary"
            onClick={handleConfirmProperties}
            disabled={selectedProperties.length === 0}
          >
            {intl.formatMessage({ id: 'common.confirm' })}
          </Button>,
        ]}
      >
        {detailLoading ? (
          <div className="ub ub-ac ub-pc loadingContainer">
            <Spin />
          </div>
        ) : currentResource ? (
          (() => {
            try {
              const targetContent = currentResource?.extInfo?.targetContent
                ? JSON.parse(currentResource.extInfo.targetContent)
                : null;
              const hasObjects = targetContent?.objects && targetContent.objects.length > 0;

              const fieldsFilter = targetContent?.fields?.filter((field: any) => {
                const keyword = searchKeyword.toLowerCase();
                return field.propertyName && field.propertyName.toLowerCase().includes(keyword);
              });

              const tabs = [];
              // 关联对象
              if (hasObjects) {
                const selectedRelatedObjectKey = getRelatedObjectKey(selectedRelatedObject);
                const selectedRelatedObjectDetail = selectedRelatedObjectKey
                  ? relatedObjectDetailMap[selectedRelatedObjectKey]
                  : null;
                const selectedRelatedObjectTargetContent = selectedRelatedObjectDetail?.extInfo?.targetContent
                  ? JSON.parse(selectedRelatedObjectDetail.extInfo.targetContent)
                  : null;
                const relatedObjectFields = selectedRelatedObjectTargetContent?.fields || [];
                const filteredRelatedObjectFields = relatedObjectFields.filter((field: any) => {
                  const keyword = searchKeyword.toLowerCase();
                  return field.propertyName && field.propertyName.toLowerCase().includes(keyword);
                });

                tabs.push(
                  <TabPane tab={intl.formatMessage({ id: 'resource.relatedObjects' })} key="objects">
                    <div className={styles.relatedObjectsLayout}>
                      {/* 关联对象-左侧对象列表 */}
                      <div className={styles.relatedObjectsLeft}>
                        <List
                          dataSource={targetContent.objects}
                          renderItem={(object: any, index: number) => {
                            const objectKey = getRelatedObjectKey(object);
                            const objectCitationKey = getRelatedObjectCitationKey(object, index);
                            return (
                              <List.Item
                                className={classnames(styles.relatedObjectItem, {
                                  [styles.relatedObjectItemActive]: objectKey === selectedRelatedObjectKey,
                                })}
                                onClick={() => handleRelatedObjectClick(object)}
                              >
                                <div className={styles.relatedObjectContent}>
                                  <Checkbox
                                    checked={selectedProperties.includes(objectCitationKey)}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                    }}
                                    onChange={(e) => handlePropertyChange(objectCitationKey, e.target.checked)}
                                  />
                                  <div className={styles.relatedObjectInfo}>
                                    <div className={styles.relatedObjectName}>{object.resourceName}</div>
                                    <div className={styles.relatedObjectCode}>
                                      {object.resourceCode || object.resourceId}
                                    </div>
                                  </div>
                                </div>
                              </List.Item>
                            );
                          }}
                        />
                      </div>
                      {/* 关联对象-右侧属性列表 */}
                      <div className={styles.relatedObjectsRight}>
                        <div className={styles.checkboxContainer}>
                          <Checkbox
                            checked={selectAll}
                            indeterminate={selectAllIndeterminate}
                            disabled={
                              !selectedRelatedObject || relatedObjectLoading || !filteredRelatedObjectFields.length
                            }
                            onChange={(e) => handleSelectAll(e.target.checked, 'object')}
                          >
                            {intl.formatMessage({ id: 'common.selectAll' })}
                          </Checkbox>
                        </div>
                        {relatedObjectLoading ? (
                          <div className={classnames('ub ub-ac ub-pc', styles.relatedObjectLoading)}>
                            <Spin />
                          </div>
                        ) : filteredRelatedObjectFields.length ? (
                          <div className={styles.propertiesGrid}>
                            {filteredRelatedObjectFields.map((field: any, index: number) => (
                              <div key={field.propertyCode || index} className={styles.propertyItem}>
                                <Checkbox
                                  checked={selectedProperties.includes(
                                    getRelatedObjectFieldKey(selectedRelatedObject, field, index)
                                  )}
                                  onChange={(e) =>
                                    handlePropertyChange(
                                      getRelatedObjectFieldKey(selectedRelatedObject, field, index),
                                      e.target.checked
                                    )
                                  }
                                >
                                  <span className={styles.propertyName}>{field.propertyName}</span>
                                </Checkbox>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className={styles.emptyWrap}>
                            <Empty description={intl.formatMessage({ id: 'common.noData' })} />
                          </div>
                        )}
                      </div>
                    </div>
                  </TabPane>
                );
              }

              // 属性信息
              tabs.push(
                <TabPane tab={intl.formatMessage({ id: 'resource.propertyInfo' })} key="properties">
                  {fieldsFilter.length ? (
                    <div className={styles.checkboxContainer}>
                      <Checkbox
                        checked={selectAll}
                        indeterminate={selectAllIndeterminate}
                        onChange={(e) => handleSelectAll(e.target.checked, 'field')}
                      >
                        {intl.formatMessage({ id: 'common.selectAll' })}
                      </Checkbox>
                    </div>
                  ) : null}
                  <div className={styles.propertiesContainer}>
                    <div className={styles.propertiesGrid}>
                      {fieldsFilter.length ? (
                        fieldsFilter.map((field: any, index: number) => (
                          <div key={index} className={styles.propertyItem}>
                            <Checkbox
                              checked={selectedProperties.includes(`field_${field.propertyCode || index}`)}
                              onChange={(e) =>
                                handlePropertyChange(`field_${field.propertyCode || index}`, e.target.checked)
                              }
                            >
                              <span className={styles.propertyName}>{field.propertyName}</span>
                            </Checkbox>
                          </div>
                        ))
                      ) : (
                        <div className={styles.emptyWrap}>
                          <Empty description={intl.formatMessage({ id: 'common.noData' })} />
                        </div>
                      )}
                    </div>
                  </div>
                </TabPane>
              );

              if (tabs.length > 0) {
                return (
                  <Tabs
                    defaultActiveKey={tabs[0].key as string}
                    activeKey={activeTabKey || (tabs[0].key as string)}
                    onChange={setActiveTabKey}
                    tabBarExtraContent={
                      (activeTabKey || (tabs[0].key as string)) === 'properties' ? (
                        <Input
                          placeholder={intl.formatMessage({ id: 'common.searchKeyword' })}
                          value={searchKeyword}
                          onChange={(e) => setSearchKeyword(e.target.value)}
                          className={styles.searchInput}
                        />
                      ) : (activeTabKey || (tabs[0].key as string)) === 'objects' ? (
                        <Input
                          placeholder={intl.formatMessage({ id: 'common.searchKeyword' })}
                          value={searchKeyword}
                          onChange={(e) => setSearchKeyword(e.target.value)}
                          className={styles.searchInput}
                        />
                      ) : null
                    }
                  >
                    {tabs}
                  </Tabs>
                );
              } else {
                return (
                  <div className={styles.emptyWrap}>
                    <Empty description={intl.formatMessage({ id: 'common.noData' })} />
                  </div>
                );
              }
            } catch (error) {
              return (
                <div className={styles.emptyWrap}>
                  <Empty description={intl.formatMessage({ id: 'common.noData' })} />
                </div>
              );
            }
          })()
        ) : null}
      </Modal>
    </div>
  );
};

export default ResourceList;
