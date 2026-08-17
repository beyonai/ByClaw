import React from 'react';
import { useIntl } from '@umijs/max';

import AutomationListPanel from './components/AutomationPanel';

import styles from './index.module.less';

/**
 * 应用级「自动化」页。
 * 自动化不跟随全局项目作用域：这里跨项目列出全部需求渠道。
 * 项目只是渠道自身的归属字段（后端扫描落库、需求启动依赖它），新增时在表单里选。
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
        <AutomationListPanel />
      </div>
    </div>
  );
};

export default Automation;
