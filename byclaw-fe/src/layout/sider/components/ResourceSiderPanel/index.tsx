import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SearchOutlined } from '@ant-design/icons';
import { Empty, Input, List, Typography } from 'antd';
import { useIntl, useLocation, useNavigate, useSelector } from '@umijs/max';
import classNames from 'classnames';
import { trim } from 'lodash';
import AntdIcon from '@/components/AntdIcon';
import ResourceDetail from '@/components/Resources/components/ResourceDetail';
import InfiniteScrollAntdList from '@/layout/sider/components/InfiniteScrollAntdList';
import employeeStyles from '@/layout/sider/components/EmployeeList/index.module.less';
import { qrySkillListByUserCode, queryDigEmployeeRelResourceAuth } from '@/pages/manager/service/resources';
import { useSkillDetailDrawer } from '@/pages/manager/components/SkillDetailDrawer/useSkillDetailDrawer';
import { ResourceTypeMap } from '@/constants/resource';
import { resourceBizTypeMap } from '@/constants/knowledge';
import useGlobal from '@/hooks/useGlobal';
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
    navigatePath: string;
    siderKey: string;
    resourceBizTypeList: string[];
  }
> = {
  TOOL: {
    icon: 'icon-chajian',
    labelId: 'common.tool',
    navigatePath: '/toolCenter',
    siderKey: 'tool',
    resourceBizTypeList: [ResourceTypeMap.Agent, ResourceTypeMap.MCP, ResourceTypeMap.TOOLKIT],
  },
  VIEW: {
    icon: 'icon-a-yemian-line',
    labelId: 'common.resourceType.view',
    navigatePath: '/viewCenter',
    siderKey: 'view',
    resourceBizTypeList: [ResourceTypeMap.VIEW],
  },
  OBJECT: {
    icon: 'icon-tongxun',
    labelId: 'common.resourceType.object',
    navigatePath: '/objectCenter',
    siderKey: 'object',
    resourceBizTypeList: [ResourceTypeMap.OBJECT],
  },
  SKILL: {
    icon: 'icon-chajian',
    labelId: 'common.skill',
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
  const { placeholder: skillDetailDrawerHolder, show: showSkillDetailDrawer } = useSkillDetailDrawer();
  const listFetchRef = useRef(false);
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
  const [resourceDetailOpen, setResourceDetailOpen] = useState(false);
  const [currentItem, setCurrentItem] = useState<ResourceItem | null>(null);

  const config = resourceConfigMap[resourceType];
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
        if (resourceType === 'SKILL') {
          const response = await qrySkillListByUserCode({
            userCode: userInfo?.userCode,
            keyword: trim(queryKeyword),
          });
          const rows = (Array.isArray(response) ? response : []).map((item: any, index: number) => ({
            ...item,
            resourceId: item.skillPath || item.resourceId || index,
            resourceName: item.skillName || item.resourceName,
            resourceDesc: item.skillDescZh || item.skillDescEn || item.resourceDesc,
            resourceBizType: ResourceTypeMap.SKILL,
            id: item.skillPath || item.resourceId || index,
          }));
          paginationRef.current = {
            pageNum: 1,
            total: rows.length,
            loadedCount: rows.length,
          };
          setResourceList(rows);
          setHasMore(false);
          return;
        }

        const response = await queryDigEmployeeRelResourceAuth({
          pageNum,
          pageSize: PAGE_SIZE,
          keyword: trim(queryKeyword),
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
    [config.resourceBizTypeList, resourceType, userInfo?.userCode]
  );

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

  const handleSearch = () => {
    const nextKeyword = trim(searchValue);
    keywordRef.current = nextKeyword;
    paginationRef.current = {
      pageNum: 0,
      total: 0,
      loadedCount: 0,
    };
    loadResources({ reset: true, queryKeyword: nextKeyword });
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
        showSkillDetailDrawer({
          id: resourceId,
          title: titleMap[resourceBizType] || intl.formatMessage({ id: 'common.detail' }),
        });
      }
      return;
    }

    setCurrentItem(item);
    setResourceDetailOpen(true);
  };

  return (
    <div className={styles.container}>
      <div
        className={classNames(styles.router, 'ub ub-ac ub-pj pointer gap2')}
        onClick={() =>
          navigate(
            isResourceCenterPage
              ? {
                pathname: '/chat',
              }
              : config.navigatePath,
            isResourceCenterPage ? { state: { keepSiderActiveKey: config.siderKey } } : undefined
          )
        }
      >
        <AntdIcon type={config.icon} />
        <span className={styles.middle}>{intl.formatMessage({ id: config.labelId })}中心</span>
        <AntdIcon
          type={isResourceCenterPage ? 'icon-a-Leftzuo' : 'icon-a-Rightyou'}
          style={{ fontSize: 16, marginLeft: 'auto' }}
        />
      </div>
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
          next={() => loadResources()}
          renderEmpty={<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          renderItem={(item: ResourceItem) => (
            <List.Item key={item.resourceId} className={styles.resourceItem} onClick={() => handleDetail(item)}>
              <List.Item.Meta
                avatar={
                  <span className={styles.resourceAvatar}>
                    <AntdIcon type={getResourceIcon()} />
                  </span>
                }
                title={
                  <Title className={employeeStyles.name}>
                    <span className={employeeStyles.nameRow} title={item.resourceName}>
                      <span className={employeeStyles.nameText}>{item.resourceName}</span>
                    </span>
                  </Title>
                }
                description={
                  <Paragraph
                    className={employeeStyles.description}
                    ellipsis={{ tooltip: { title: item.resourceDesc, placement: 'right' } }}
                  >
                    {item.resourceDesc}
                  </Paragraph>
                }
              />
            </List.Item>
          )}
        />
      </div>
      {resourceDetailOpen && (
        <ResourceDetail
          visible={resourceDetailOpen}
          resourceId={currentItem?.resourceId}
          item={currentItem}
          resourceType={resourceType}
          resourceName={getResourceName()}
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

export default ResourceSiderPanel;
