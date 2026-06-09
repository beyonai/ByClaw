import React, { useEffect, useRef, useState } from 'react';
import { SearchOutlined } from '@ant-design/icons';
import { Empty, Input, List, Typography } from 'antd';
import { useIntl, useNavigate } from '@umijs/max';
import classNames from 'classnames';
import { trim } from 'lodash';
import AntdIcon from '@/components/AntdIcon';
import ResourceDetail from '@/components/Resources/components/ResourceDetail';
import InfiniteScrollAntdList from '@/layout/sider/components/InfiniteScrollAntdList';
import employeeStyles from '@/layout/sider/components/EmployeeList/index.module.less';
import { listResourceUseAuth } from '@/pages/manager/service/resources';
import { useSkillDetailDrawer } from '@/pages/manager/components/SkillDetailDrawer/useSkillDetailDrawer';
import { ResourceTypeMap } from '@/constants/resource';
import { resourceBizTypeMap } from '@/constants/knowledge';
import styles from './index.module.less';

const { Title, Paragraph } = Typography;

type ResourceSiderType = 'TOOL' | 'VIEW' | 'OBJECT';

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
    resourceBizTypeList: string[];
  }
> = {
  TOOL: {
    icon: 'icon-chajian',
    labelId: 'common.tool',
    navigatePath: '/toolCenter',
    resourceBizTypeList: [ResourceTypeMap.Agent, ResourceTypeMap.MCP, ResourceTypeMap.TOOLKIT],
  },
  VIEW: {
    icon: 'icon-a-yemian-line',
    labelId: 'common.resourceType.view',
    navigatePath: '/viewCenter',
    resourceBizTypeList: [ResourceTypeMap.VIEW],
  },
  OBJECT: {
    icon: 'icon-tongxun',
    labelId: 'common.resourceType.object',
    navigatePath: '/objectCenter',
    resourceBizTypeList: [ResourceTypeMap.OBJECT],
  },
};

const ResourceSiderPanel: React.FC<Props> = ({ resourceType }) => {
  const intl = useIntl();
  const navigate = useNavigate();
  const { placeholder: skillDetailDrawerHolder, show: showSkillDetailDrawer } = useSkillDetailDrawer();
  const listFetchRef = useRef(false);
  const [searchValue, setSearchValue] = useState('');
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [resourceList, setResourceList] = useState<ResourceItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [resourceDetailOpen, setResourceDetailOpen] = useState(false);
  const [currentItem, setCurrentItem] = useState<ResourceItem | null>(null);

  const config = resourceConfigMap[resourceType];
  const placeholder = intl.formatMessage(
    { id: 'form.inputPlaceholder' },
    {
      content: intl.formatMessage({ id: 'knowledgeDetail.keywords' }),
    }
  );

  const loadResources = async (queryKeyword = keyword) => {
    if (listFetchRef.current) return;
    listFetchRef.current = true;
    setLoading(true);
    try {
      const response = await listResourceUseAuth({
        pageNum: 1,
        pageSize: 30,
        keyword: trim(queryKeyword),
        resourceBizTypeList: config.resourceBizTypeList,
      });
      const rows = Array.isArray(response?.rows) ? response.rows : Array.isArray(response?.list) ? response.list : [];
      setResourceList(rows);
      setHasMore(false);
    } catch {
      setResourceList([]);
      setHasMore(false);
    } finally {
      listFetchRef.current = false;
      setLoading(false);
    }
  };

  useEffect(() => {
    setKeyword('');
    setSearchValue('');
    setHasMore(false);
    loadResources('');
  }, [resourceType]);

  const handleSearch = () => {
    const nextKeyword = trim(searchValue);
    setKeyword(nextKeyword);
    loadResources(nextKeyword);
  };

  const getResourceIcon = () => {
    if (resourceType === 'TOOL') return 'icon-chajiantubiao';
    return 'icon-chuangjianfangshi-shujuku';
  };

  const getResourceName = () => {
    if (resourceType === 'TOOL') return intl.formatMessage({ id: 'resource.tool' });
    if (resourceType === 'VIEW') return intl.formatMessage({ id: 'resource.view' });
    if (resourceType === 'OBJECT') return intl.formatMessage({ id: 'resource.object' });
    return intl.formatMessage({ id: 'resource.default' });
  };

  const handleDetail = (item: ResourceItem) => {
    const { resourceBizType, resourceId } = item;

    if (
      resourceBizType &&
      [resourceBizTypeMap.MCP, resourceBizTypeMap.TOOL, resourceBizTypeMap.TOOLKIT, resourceBizTypeMap.AGENT].includes(
        resourceBizType
      )
    ) {
      const titleMap: Record<string, string> = {
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

    setCurrentItem(item);
    setResourceDetailOpen(true);
  };

  return (
    <div className={styles.container}>
      <div
        className={classNames(styles.router, 'ub ub-ac ub-pj pointer gap2')}
        onClick={() => navigate(config.navigatePath)}
      >
        <AntdIcon type={config.icon} />
        <span className={styles.middle}>{intl.formatMessage({ id: config.labelId })}中心</span>
        <AntdIcon type="icon-a-Rightyou" style={{ fontSize: 16, marginLeft: 'auto' }} />
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
