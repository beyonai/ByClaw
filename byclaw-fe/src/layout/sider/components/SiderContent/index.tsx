import React, { lazy, useMemo } from 'react';
import { Tabs } from 'antd';
import { useSelector } from '@umijs/max';
import classnames from 'classnames';
import useVisibleMenuKeys from '../../useVisibleMenuKeys';
import styles from './index.module.less';

const DialogueList = lazy(() => import('@/layout/sider/components/DialogueList'));
const EmployeeList = lazy(() => import('@/layout/sider/components/EmployeeList'));
const Knowledge = lazy(() => import('@/layout/sider/components/Knowledge'));
const ResourceSiderPanel = lazy(() => import('@/layout/sider/components/ResourceSiderPanel'));
const SearchAndQuery = lazy(() => import('@/layout/sider/components/SearchAndQuery'));

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
    ChildComponent: DialogueList,
    navigatePath: '/chat',
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
    icon: 'icon-tongxun',
    activeIcon: 'icon-tongxun-fill',
    label: 'common.resourceType.object',
    ChildComponent: ObjectSiderPanel,
    navigatePath: '/objectCenter',
    // hideSider: true,
  },
  {
    key: 'skill',
    icon: 'icon-chajian',
    activeIcon: 'icon-chajian-fill',
    label: 'common.skill',
    ChildComponent: SkillSiderPanel,
    navigatePath: '/skillCenter',
    // hideSider: true,
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
      visibleKeys
        .map((key) => tabItems.find((pageItem) => pageItem.key === key))
        .filter((pageItem): pageItem is (typeof tabItems)[number] => !!pageItem)
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
