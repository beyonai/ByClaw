import React from 'react';
import { Tabs } from 'antd';
import { useIntl } from '@umijs/max';

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

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h2 className={styles.title}>{intl.formatMessage({ id: 'automation.title' })}</h2>
        <div className={styles.subtitle}>{intl.formatMessage({ id: 'automation.description' })}</div>
      </div>
      <div className={styles.body}>
        {/* Tabs 默认懒挂载未激活面板，运行记录不会在进页面时就发请求。 */}
        <Tabs
          items={[
            {
              key: 'list',
              label: intl.formatMessage({ id: 'automation.tab.list' }),
              children: <AutomationListPanel />,
            },
            {
              key: 'runs',
              label: intl.formatMessage({ id: 'automation.tab.runs' }),
              children: <AutomationRunPanel />,
            },
          ]}
        />
      </div>
    </div>
  );
};

export default Automation;
