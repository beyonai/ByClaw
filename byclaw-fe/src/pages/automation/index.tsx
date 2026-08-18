import React from 'react';
import AutomationListPanel from './components/AutomationPanel';

/**
 * 应用级「自动化」页。
 * 自动化不跟随全局项目作用域，列表按创建人收窄（后端 onlyMine），只列出当前用户自己建的自动化。
 * 「运行记录」页签按同一条口径反查这批自动化的历次调度结果。
 */
const Automation: React.FC = () => {
  return <AutomationListPanel />;
};

export default Automation;
