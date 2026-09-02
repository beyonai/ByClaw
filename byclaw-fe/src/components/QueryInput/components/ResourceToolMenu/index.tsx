import { LinkOutlined } from '@ant-design/icons';
import classNames from 'classnames';
import { useIntl, useSelector } from '@umijs/max';
import { useEffect, useState } from 'react';
import { Empty } from 'antd';
import AntdIcon from '@/components/AntdIcon';
import EmployeeList from '@/layout/sider/components/EmployeeList';
import FileResourcePanel from '@/components/ChatLayoutComp/ChatResourceWorkspace/FileResourcePanel';
import ConnectorControl from '../ConnectorControl';
import ResourceTabs from '../../RichInput/mentionPopover/resourceTabsCompact';
import { chatModeMap } from '@/constants/query';
import { ResourceType } from '../../RichInput/utils/constants';
import styles from '../../index.module.less';

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
  onSelect,
}) => {
  const intl = useIntl();
  const currentUserInfo = useSelector((state: any) => state.user?.userInfo);
  const [activeKey, setActiveKey] = useState('expert');
  const [visitedKeys, setVisitedKeys] = useState<string[]>(['expert']);
  useEffect(() => {
    if (!activeKeyProp) return;
    setActiveKey(activeKeyProp);
    setVisitedKeys((current) => (current.includes(activeKeyProp) ? current : [...current, activeKeyProp]));
  }, [activeKeyProp]);
  const tabs = [
    {
      key: 'expert',
      label: intl.formatMessage({ id: 'common.digitalEmployee' }),
      icon: 'icon-cebianlan-shuziyuangong',
    },
    { key: 'skill', label: '技能', icon: 'icon-chajian' },
    { key: 'connector', label: '连接器', icon: <LinkOutlined aria-hidden /> },
    { key: 'processFile', label: '过程文件', icon: 'icon-a-Data-fileshujuwenjian' },
    { key: 'projectCloud', label: '项目云盘', icon: 'icon-a-Folder-openwenjianjia-kai' },
    { key: 'tool', label: '工具', icon: 'icon-a-Database-networkshujukuwangluo' },
    { key: 'knowledge', label: '知识', icon: 'icon-zhishi' },
    { key: 'object', label: '本体', icon: 'icon-tongxun' },
  ];
  // 新会话没有可查询的过程文件，隐藏该分类；历史会话沿用右侧资源面板的会话文件数据。
  const visibleTabs = sessionId ? tabs : tabs.filter((tab) => tab.key !== 'processFile');
  useEffect(() => {
    if (sessionId || activeKey !== 'processFile') return;
    setActiveKey('expert');
    setVisitedKeys((current) => (current.includes('expert') ? current : [...current, 'expert']));
  }, [activeKey, sessionId]);
  const selectTab = (key: string) => {
    setActiveKey(key);
    setVisitedKeys((current) => (current.includes(key) ? current : [...current, key]));
  };
  const quoteAgentId =
    resourceAgentIds
      ?.split(',')
      .map((item) => item.trim())
      .find(Boolean) || agentId;
  const renderContent = (key: string) => {
    if (key === 'expert') {
      return (
        <EmployeeList
          chatMode={chatModeMap.expert}
          keyword={keyword}
          hideCategoryTabs
          compactCard
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
          projectId={projectId}
          projectCloudResourceId={projectCloudResourceId}
          resourceId={quoteAgentId}
          onOpenDetail={() => undefined}
        />
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无过程文件" />
      );
    }
    if (key === 'projectCloud') {
      return projectCloudResourceId ? (
        <FileResourcePanel
          scope="project"
          sessionId={sessionId || ''}
          projectId={projectId}
          projectCloudResourceId={projectCloudResourceId}
          resourceId={projectCloudResourceId}
          onOpenDetail={() => undefined}
        />
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂未初始化项目知识库" />
      );
    }
    return (
      <ResourceTabs
        open
        keyword={keyword}
        agentId={quoteAgentId}
        sessionId={sessionId}
        agentIds={resourceAgentIds}
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
      <div className={styles.toolsMenuPanel}>
        {visitedKeys.map((key) => (
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
