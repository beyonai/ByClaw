import { CodeOutlined, LinkOutlined } from '@ant-design/icons';
import classNames from 'classnames';
import { useIntl, useSelector } from '@umijs/max';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Empty } from 'antd';
import AntdIcon from '@/components/AntdIcon';
import EmployeeList from '@/layout/sider/components/EmployeeList';
import ProjectSpaceTab from '@/layout/sider/components/ProjectSpaceList/ProjectSpaceTab';
import { useActiveSiderAgent } from '@/layout/sider/components/ActiveSiderAgentBar';
import FileResourcePanel from '@/components/ChatLayoutComp/ChatResourceWorkspace/FileResourcePanel';
import { getSessionResourceTabKeys } from '@/components/ChatLayoutComp/ChatResourceWorkspace/resourceTabUtils';
import { useChatResourceProject } from '@/components/ChatLayoutComp/ChatResourceWorkspace/useChatResourceProject';
import ConnectorControl from '../ConnectorControl';
import ResourceTabs from '../../RichInput/mentionPopover/resourceTabsCompact';
import { chatModeMap } from '@/constants/query';
import { HIDDEN_RESOURCE_MENU_KEYS } from '@/constants/system';
import { ResourceType } from '../../RichInput/utils/constants';
import styles from '../../index.module.less';
import FilePicker from './FilePicker';

interface Props {
  keyword?: string;
  sessionId?: string;
  projectId?: number;
  projectCloudResourceId?: string | number;
  agentId?: string;
  resourceAgentIds?: string;
  excludedAgentIds?: string[];
  userInfo?: any;

  /** 打开资源面板时需要激活的分类。 */
  activeKey?: string;

  /** 分类自然高度，用于限制外层弹窗高度。 */
  onNavigationHeightChange?: (height: number) => void;
  onSelect: (item: any, type: any) => void;
}

const ResourceToolMenu: React.FC<Props> = ({
  keyword,
  sessionId,
  projectId,
  projectCloudResourceId,
  agentId,
  resourceAgentIds,
  excludedAgentIds,
  userInfo,
  activeKey: activeKeyProp,
  onNavigationHeightChange,
  onSelect,
}) => {
  const intl = useIntl();
  const navigationContentRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const content = navigationContentRef.current;
    if (!content || !onNavigationHeightChange) return;
    // 测量不受弹窗高度约束的内层，避免拿到被拉伸后的导航高度。
    const measure = () => onNavigationHeightChange(content.offsetHeight + 16);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [onNavigationHeightChange]);
  const { project } = useChatResourceProject(projectId);
  const activeEmployee = useActiveSiderAgent();
  const projectSpaceResourceId =
    activeEmployee.resourceId || (project?.resourceId ? `${project.resourceId}` : undefined);
  const resolvedProjectId = Number(project?.projectId ?? projectId);
  const resolvedCloudResourceId = projectCloudResourceId ?? project?.cloudResourceId;
  const visibleFileKeys = useMemo(() => {
    const menuKeyMap = { file: 'processFile', sharedFile: 'file', projectFile: 'projectCloud', code: 'projectCode' };
    return getSessionResourceTabKeys(resolvedProjectId, sessionId).map((key) => menuKeyMap[key]);
  }, [resolvedProjectId, sessionId]);
  const currentUserInfo = useSelector((state: any) => state.user?.userInfo);
  const defaultDigEmployeeId = useSelector(
    (state: any) => state.employees?.defaultDigEmployeeId || state.user?.userInfo?.defaultDigEmployeeId
  );
  const [activeKey, setActiveKey] = useState('expert');
  const [visitedKeys, setVisitedKeys] = useState<string[]>(['expert']);
  useEffect(() => {
    if (!activeKeyProp || HIDDEN_RESOURCE_MENU_KEYS.has(activeKeyProp)) return;
    setActiveKey(activeKeyProp);
    setVisitedKeys((current) => (current.includes(activeKeyProp) ? current : [...current, activeKeyProp]));
  }, [activeKeyProp]);
  const tabs = [
    {
      key: 'expert',
      label: intl.formatMessage({ id: 'common.digitalEmployee' }),
      icon: 'icon-cebianlan-shuziyuangong',
    },
    { key: 'skill', label: intl.formatMessage({ id: 'queryInput.tools.skill' }), icon: 'icon-chajian' },
    {
      key: 'tool',
      label: intl.formatMessage({ id: 'queryInput.tools.tool' }),
      icon: 'icon-a-Database-networkshujukuwangluo',
    },
    { key: 'knowledge', label: intl.formatMessage({ id: 'queryInput.tools.knowledge' }), icon: 'icon-zhishi' },
    {
      key: 'connector',
      label: intl.formatMessage({ id: 'queryInput.tools.connector' }),
      icon: <LinkOutlined aria-hidden />,
    },
    {
      key: 'processFile',
      label: intl.formatMessage({ id: 'queryInput.tools.processFile' }),
      icon: 'icon-a-Data-fileshujuwenjian',
    },
    {
      key: 'file',
      label: intl.formatMessage({ id: 'chatResource.localSharedFile' }),
      icon: 'icon-a-Folder-openwenjianjia-kai',
    },
    {
      key: 'projectCloud',
      label: intl.formatMessage({ id: 'queryInput.tools.projectCloud' }),
      icon: 'icon-a-Folder-openwenjianjia-kai',
    },
    {
      key: 'projectCode',
      label: intl.formatMessage({ id: 'chatResource.projectSpace' }),
      icon: <CodeOutlined aria-hidden />,
    },
  ];
  const visibleTabs = tabs.filter(
    (tab) =>
      !['processFile', 'projectCloud', 'file', 'projectCode'].includes(tab.key) || visibleFileKeys.includes(tab.key)
  );
  useEffect(() => {
    // 已访问面板也必须随入口隐藏，不能继续展示或加载上一项目的数据。
    const fileKeys = ['processFile', 'projectCloud', 'file', 'projectCode'];
    if (fileKeys.includes(activeKey) && !visibleFileKeys.includes(activeKey)) setActiveKey('expert');
    setVisitedKeys((current) => current.filter((key) => !fileKeys.includes(key) || visibleFileKeys.includes(key)));
  }, [activeKey, visibleFileKeys]);
  const visibleVisitedKeys = visitedKeys.filter((key) => visibleTabs.some((tab) => tab.key === key));
  const selectTab = (key: string) => {
    setActiveKey(key);
    setVisitedKeys((current) => (current.includes(key) ? current : [...current, key]));
  };
  const normalizedResourceAgentIds = resourceAgentIds
    ?.split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .join(',');
  const scopedAgentId = normalizedResourceAgentIds?.split(',').find(Boolean);
  const defaultResourceAgentId =
    typeof defaultDigEmployeeId === 'string' || typeof defaultDigEmployeeId === 'number'
      ? `${defaultDigEmployeeId}`
      : undefined;
  const quoteAgentId = scopedAgentId || agentId || defaultResourceAgentId;
  const queryAgentIds = normalizedResourceAgentIds || (quoteAgentId ? `${quoteAgentId}` : undefined);
  const renderContent = (key: string) => {
    if (key === 'file') return <FilePicker onSelect={onSelect} />;
    if (key === 'projectCode') {
      // 与右侧边栏共用项目目录组件及资源作用域，普通文件和 Git 仓库均来自同一项目空间。
      return (
        <ProjectSpaceTab
          projectId={resolvedProjectId}
          sessionId={sessionId}
          resourceId={projectSpaceResourceId}
          projectCloudResourceId={resolvedCloudResourceId ? `${resolvedCloudResourceId}` : undefined}
        />
      );
    }
    if (key === 'expert') {
      return (
        <EmployeeList
          chatMode={chatModeMap.expert}
          keyword={keyword}
          hideCategoryTabs
          compactCard
          includeEmployeeGroups
          excludedAgentIds={excludedAgentIds}
          onSelect={(item) => onSelect(item, ResourceType.digitalEmployee)}
        />
      );
    }
    if (key === 'connector') {
      return (
        <ConnectorControl
          canAuthorize={!!(userInfo || currentUserInfo)}
          userInfo={userInfo || currentUserInfo}
          inline
        />
      );
    }
    if (key === 'processFile') {
      return sessionId ? (
        <FileResourcePanel
          scope="session"
          sessionId={sessionId}
          projectId={resolvedProjectId}
          projectCloudResourceId={resolvedCloudResourceId}
          resourceId={quoteAgentId}
          onOpenDetail={() => undefined}
        />
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={intl.formatMessage({ id: 'queryInput.tools.noProcessFiles' })}
        />
      );
    }
    if (key === 'projectCloud') {
      return resolvedCloudResourceId ? (
        <FileResourcePanel
          scope="project"
          sessionId={sessionId || ''}
          projectId={resolvedProjectId}
          projectCloudResourceId={resolvedCloudResourceId}
          resourceId={resolvedCloudResourceId}
          onOpenDetail={() => undefined}
        />
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={intl.formatMessage({ id: 'queryInput.tools.noProjectKnowledge' })}
        />
      );
    }
    return (
      <ResourceTabs
        open
        keyword={keyword}
        agentId={quoteAgentId}
        sessionId={sessionId}
        agentIds={queryAgentIds}
        onlyTab={key}
        // 加号/@面板左侧已经提供资源分类，右侧各资源统一保持“搜索框 + 列表”布局。
        hideTabBar
        hideBorder
        showKnowledgeTab
        showSkillTab
        onSelect={onSelect}
      />
    );
  };
  return (
    <div className={styles.toolsMenu} data-resource-tool-menu="true">
      <div className={styles.toolsMenuNav}>
        <div ref={navigationContentRef}>
          {visibleTabs.map((tab) => (
            <button
              type="button"
              key={tab.key}
              className={classNames(styles.toolsMenuNavItem, activeKey === tab.key && styles.toolsMenuNavItemActive)}
              onMouseEnter={() => selectTab(tab.key)}
              onFocus={() => selectTab(tab.key)}
              onClick={() => selectTab(tab.key)}
            >
              {typeof tab.icon === 'string' ? <AntdIcon type={tab.icon} /> : tab.icon}
              <span>{tab.label}</span>
              <AntdIcon type="icon-a-Arrow-rightjiantouyou" />
            </button>
          ))}
        </div>
      </div>
      <div className={styles.toolsMenuPanel}>
        {visibleVisitedKeys.map((key) => (
          <div
            key={key}
            className={classNames(
              styles.toolsMenuPanelContent,
              activeKey === key && styles.toolsMenuPanelContentActive
            )}
          >
            {renderContent(key)}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ResourceToolMenu;
