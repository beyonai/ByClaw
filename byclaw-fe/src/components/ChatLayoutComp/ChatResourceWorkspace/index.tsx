import React, { useContext, useMemo } from 'react';
import { Button, Tabs } from 'antd';
import { useIntl } from '@umijs/max';
import { SiderContentContext, type DetailPanelOptions } from '@/layout/sider/siderContentContext';
import ResourcePanel from './ResourcePanel';
import ResourceListIcon from './ResourceListIcon';
import type { ChatResourceTab } from './tabState';
import styles from './index.module.less';

interface ChatResourceWorkspaceProps {
  sessionId: string;
  projectId?: number;
  cloudResourceId?: string | number;
  listOpen: boolean;
  tabs: ChatResourceTab[];
  activeTabKey: string;
  onToggleList: () => void;
  onOpenDetail: (panel: React.ReactNode, options?: DetailPanelOptions) => void;
  onActiveTabChange: (key: string) => void;
  onCloseTab: (key: string) => void;
}

const ChatResourceWorkspace: React.FC<ChatResourceWorkspaceProps> = ({
  sessionId,
  projectId,
  cloudResourceId,
  listOpen,
  tabs,
  activeTabKey,
  onToggleList,
  onOpenDetail,
  onActiveTabChange,
  onCloseTab,
}) => {
  const intl = useIntl();
  const outerContext = useContext(SiderContentContext);

  // 资源组件依赖同一 Context；嵌套后只替换详情回调，引用、分享等左侧行为保持不变。
  const nestedContext = useMemo(
    () => ({
      siderContentWidth: outerContext.siderContentWidth,
      setSiderContentWidth: outerContext.setSiderContentWidth,
      setDetailPanel: onOpenDetail,
      clearDetailPanel: () => {
        if (activeTabKey) onCloseTab(activeTabKey);
      },
    }),
    [activeTabKey, onCloseTab, onOpenDetail, outerContext.setSiderContentWidth, outerContext.siderContentWidth]
  );

  const resourcePanel = (
    <ResourcePanel
      key={sessionId}
      sessionId={sessionId}
      projectId={projectId}
      cloudResourceId={cloudResourceId}
      onOpenDetail={(panel, options) => onOpenDetail(panel, options)}
    />
  );
  const hasDetailTabs = tabs.length > 0;
  const hasFilePreview = tabs.some((tab) => tab.key.includes('file:'));

  return (
    <SiderContentContext.Provider value={nestedContext}>
      <div className={styles.workspace}>
        {hasDetailTabs && (
          <>
            <div className={styles.workspaceHeader}>
              <Button
                type="text"
                className={`${styles.resourceToggle} ${listOpen ? styles.resourceToggleActive : ''}`}
                icon={<ResourceListIcon className={styles.resourceToggleIcon} />}
                onClick={(event) => {
                  // 三横线只收起/展开资源列表，阻止事件冒泡到外层详情容器影响文件预览页签。
                  event.preventDefault();
                  event.stopPropagation();
                  onToggleList();
                }}
                aria-label={intl.formatMessage({ id: 'chatResource.toggleList' })}
              />
              <Tabs
                className={styles.workspaceTabs}
                type="editable-card"
                hideAdd
                activeKey={activeTabKey}
                onChange={onActiveTabChange}
                onEdit={(targetKey, action) => {
                  if (action === 'remove') onCloseTab(`${targetKey}`);
                }}
                items={tabs.map((tab) => ({
                  key: tab.key,
                  label: tab.title,
                }))}
              />
            </div>
            <div className={styles.workspaceDetail}>
              {/* 非激活页签保持挂载，切换时保留资源详情内部的目录、表单和滚动状态。 */}
              {tabs.map((tab) => (
                <div
                  key={tab.key}
                  className={`${styles.workspaceTabPane} ${
                    tab.key === activeTabKey ? '' : styles.workspaceTabPaneHidden
                  }`}
                >
                  {tab.content}
                </div>
              ))}
            </div>
          </>
        )}
        {/* 浮窗关闭时只隐藏，不卸载，重新打开后继续保留二级筛选和列表位置。 */}
        <aside
          key="resource-list"
          className={
            hasDetailTabs
              ? `${styles.floatingResourcePanel} ${
                hasFilePreview ? styles.floatingResourcePanelHalf : ''
              } ${listOpen ? '' : styles.floatingResourcePanelHidden}`
              : styles.dockedResourcePanel
          }
          aria-hidden={hasDetailTabs && !listOpen}
        >
          {resourcePanel}
        </aside>
      </div>
    </SiderContentContext.Provider>
  );
};

export default ChatResourceWorkspace;
