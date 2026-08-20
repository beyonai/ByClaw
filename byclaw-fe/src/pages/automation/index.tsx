import React, { useState } from 'react';
import { CalendarOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import classnames from 'classnames';
import AntdIcon from '@/components/AntdIcon';
import useAppStore from '@/models/common/useAppStore';

import AutomationListPanel from './components/AutomationPanel';
import AutomationRunPanel from './components/AutomationRunPanel';

import styles from './index.module.less';

/**
 * 应用级「自动化」页。
 * 自动化不跟随全局项目作用域，列表按创建人收窄（后端 onlyMine），只列出当前用户自己建的自动化。
 * 「运行记录」页签按同一条口径反查这批自动化的历次调度结果。
 */
const Automation: React.FC = () => {
  const intl = useIntl();
  const { isSiderCollapsed } = useAppStore();
  const [activeTab, setActiveTab] = useState<'tasks' | 'runs'>('tasks');
  const tabNavigation = (
    <div
      className={classnames(styles.automationTabs, isSiderCollapsed && styles.automationTabsCollapsed)}
      role="tablist"
    >
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === 'tasks'}
        className={activeTab === 'tasks' ? styles.automationTabActive : styles.automationTab}
        onClick={() => setActiveTab('tasks')}
      >
        <AntdIcon type="icon-a-Alarm-clocknaozhong" />
        {intl.formatMessage({ id: 'automation.scheduledTasks' })}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === 'runs'}
        className={activeTab === 'runs' ? styles.automationTabActive : styles.automationTab}
        onClick={() => setActiveTab('runs')}
      >
        <CalendarOutlined />
        {intl.formatMessage({ id: 'automation.runRecords' })}
      </button>
    </div>
  );

  return (
    <div className={styles.automationPage}>
      {activeTab === 'tasks' ? (
        <AutomationListPanel headerLeading={tabNavigation} />
      ) : (
        <AutomationRunPanel headerLeading={tabNavigation} />
      )}
    </div>
  );
};

export default Automation;
