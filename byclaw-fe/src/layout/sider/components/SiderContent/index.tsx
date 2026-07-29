import React, { lazy, useMemo } from 'react';
import { Tabs } from 'antd';
import { useSelector } from '@umijs/max';
import classnames from 'classnames';
import useVisibleMenuKeys from '../../useVisibleMenuKeys';
import styles from './index.module.less';

const ProjectSpaceList = lazy(() => import('@/layout/sider/components/ProjectSpaceList'));
const EmployeeList = lazy(() => import('@/layout/sider/components/EmployeeList'));
const Knowledge = lazy(() => import('@/layout/sider/components/Knowledge'));
const ResourceSiderPanel = lazy(() => import('@/layout/sider/components/ResourceSiderPanel'));
const SearchAndQuery = lazy(() => import('@/layout/sider/components/SearchAndQuery'));
const FileSiderPanel = lazy(() => import('@/layout/sider/components/FileSiderPanel'));
const ModelSiderPanel = lazy(() => import('@/layout/sider/components/ModelSiderPanel'));

const OntologySiderPanel = lazy(() => import('@/layout/sider/components/OntologySiderPanel'));

const ToolSiderPanel = () => <ResourceSiderPanel resourceType="TOOL" />;
const ViewSiderPanel = () => <ResourceSiderPanel resourceType="VIEW" />;
const ObjectSiderPanel = () => <ResourceSiderPanel resourceType="OBJECT" />;
const SkillSiderPanel = () => <ResourceSiderPanel resourceType="SKILL" />;

export const tabItems: any[] = [
  {
    key: 'sessions',
    icon: 'icon-cebianlan-duihuajilu',
    activeIcon: 'icon-huihua-fill',
    label: 'sider.session',
    // 会话入口统一展示按项目归属分组的会话列表，避免与独立项目入口重复。
    ChildComponent: ProjectSpaceList,
    navigatePath: '/chat',
    forceRender: true,
  },
  {
    key: 'agent',
    icon: 'icon-faxian1',
    activeIcon: 'icon-faxian-fill',
    label: 'employees.title',
    ChildComponent: EmployeeList,
    navigatePath: '/digitalEmployees',
  },
  {
    key: 'searchAndQuery',
    icon: 'icon-tongxun',
    activeIcon: 'icon-tongxun-fill',
    label: 'sider.knowledgeSource',
    ChildComponent: SearchAndQuery,
    navigatePath: '/searchAndQuery',
    forceRender: true,
  },
  {
    key: 'model',
    icon: 'icon-a-Braindanao',
    activeIcon: 'icon-brain-filled',
    label: 'common.model',
    ChildComponent: ModelSiderPanel,
    navigatePath: '/models',
  },
  {
    key: 'knowledge',
    icon: 'icon-a-Boxhezioutline',
    activeIcon: 'icon-zhishi-fill',
    label: 'sider.knowledge',
    ChildComponent: Knowledge,
    navigatePath: '/knowledgeCenter',
    // hideSider: true,
  },
  {
    key: 'tool',
    icon: 'icon-chajian',
    activeIcon: 'icon-chajian-fill',
    label: 'common.tool',
    ChildComponent: ToolSiderPanel,
    navigatePath: '/toolCenter',
    // hideSider: true,
  },
  {
    key: 'view',
    icon: 'icon-a-yemian-line',
    activeIcon: 'icon-yemian-fill',
    label: 'common.resourceType.view',
    ChildComponent: ViewSiderPanel,
    navigatePath: '/viewCenter',
    // hideSider: true,
  },
  {
    key: 'object',
    icon: 'icon-mob-faxian02',
    activeIcon: 'icon-mob-faxian01',
    label: 'common.resourceType.object',
    ChildComponent: ObjectSiderPanel,
    navigatePath: '/objectCenter',
    // hideSider: true,
  },
  {
    key: 'ontology',
    icon: 'icon-a-yemian-line',
    activeIcon: 'icon-yemian-fill',
    label: 'sider.ontology',
    ChildComponent: OntologySiderPanel,
    navigatePath: '/ontologyCenter',
  },
  {
    key: 'skill',
    icon: 'icon-a-changjing-line',
    activeIcon: 'icon-changjing-fill',
    label: 'common.skill',
    ChildComponent: SkillSiderPanel,
    navigatePath: '/skillCenter',
    // hideSider: true,
  },
  {
    key: 'file',
    icon: 'icon-a-View-listxiangqingliebiao',
    activeIcon: 'icon-a-View-listxiangqingliebiao1',
    label: 'common.file',
    ChildComponent: FileSiderPanel,
    navigatePath: '/files',
  },
] as const;

type IProps = {
  activeKey: (typeof tabItems)[number]['key'];
};

const SiderContent = (props: IProps) => {
  const { activeKey } = props;
  const { userInfo } = useSelector(({ user }: any) => ({
    userInfo: user.userInfo,
  }));
  const visibleKeys = useVisibleMenuKeys(userInfo);

  const items = useMemo(
    () =>
      tabItems
        .filter((pageItem) => visibleKeys.includes(pageItem.key))
        .map((pageItem) => {
          const { key, ChildComponent, destroyOnHidden = false, disabled, forceRender = false } = pageItem;
          return {
            key,
            label: key,
            disabled,
            forceRender,
            destroyOnHidden,
            children: ChildComponent ? (
              <React.Suspense fallback={null}>
                <ChildComponent />
              </React.Suspense>
            ) : null,
          };
        }),
    [visibleKeys]
  );

  return (
    <div className={classnames(styles.siderContent, 'full-height full-width')}>
      <Tabs
        activeKey={activeKey}
        items={items}
        tabBarStyle={{
          display: 'none',
        }}
        className={classnames('full-height full-width', styles.Tabs)}
      />
    </div>
  );
};

export default SiderContent;
