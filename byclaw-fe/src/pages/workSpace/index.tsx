import AntdIcon from '@/components/AntdIcon';
import { CloseOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import React, { useState } from 'react';
import { useIntl } from '@umijs/max';

import Flie from './components/Flie';
import Member from './components/Member';
import Search from './components/Search';
import Task from './components/Task';
import Todo from './components/Todo';

import styles from './index.module.less';

const tabs = [
  {
    label: 'common.task',
    value: 'task',
  },
  {
    label: 'common.file',
    value: 'file',
  },
  {
    label: 'common.search',
    value: 'search',
  },
  {
    label: 'common.todo',
    value: 'todo',
  },
  {
    label: 'common.member',
    value: 'member',
  },
];

export const WorkSpace: React.FC = () => {
  const intl = useIntl();
  // 是否显示百应智办工作空间
  const [showWorkSpace, setShowWorkSpace] = useState(false);

  // 当前tab
  const [activeTab, setActiveTab] = useState(() => intl.formatMessage({ id: 'common.task' }));

  const switchButton = () => {
    setShowWorkSpace(!showWorkSpace);
  };

  const renderContent = () => {
    if (activeTab === 'task') {
      return <Task />;
    }
    if (activeTab === 'file') {
      return <Flie />;
    }
    if (activeTab === 'search') {
      return <Search />;
    }
    if (activeTab === 'todo') {
      return <Todo />;
    }
    if (activeTab === 'member') {
      return <Member />;
    }
    return null;
  };

  return (
    <div className={styles.workSpaceContainer}>
      {!showWorkSpace && (
        <div className={styles.switchButton}>
          <Button
            type="text"
            size="small"
            icon={<AntdIcon type="icon-cebianlan-shuziyuangong" onClick={switchButton} />}
            onClick={switchButton}
          />
        </div>
      )}
      {showWorkSpace && false && (
        <div className={styles.content}>
          {/* 头部 */}
          <div className={styles.header}>
            <span className={styles.title}>{intl.formatMessage({ id: 'workSpace.title' })}</span>
            <Button
              type="text"
              size="small"
              icon={<CloseOutlined />}
              className={styles.closeBtn}
              onClick={switchButton}
            />
          </div>
          {/* tab切换 */}
          <div className={styles.tabs}>
            {tabs.map((tab) => (
              <span
                key={tab.value}
                className={activeTab === tab.value ? styles.tabItemActive : styles.tabItem}
                onClick={() => setActiveTab(tab.value)}
              >
                {intl.formatMessage({ id: tab.label })}
              </span>
            ))}
          </div>
          {renderContent()}
        </div>
      )}
    </div>
  );
};

export default WorkSpace;
