import React from 'react';
import classnames from 'classnames';
import type { SearchTabItem } from './types';
import styles from './index.module.less';

interface Props {
  tabs: SearchTabItem[];
  activeTab: string;
  onTabChange: (title: string) => void;
}

const SearchTabs = ({ tabs, activeTab, onTabChange }: Props) => (
  <div className={styles.searchTabs}>
    {tabs.map((tab) => (
      <span
        key={tab.key}
        className={classnames(styles.searchTab, activeTab === tab.title && styles.activeTab)}
        onClick={() => onTabChange(tab.title)}
      >
        {tab.title}
      </span>
    ))}
  </div>
);

export default SearchTabs;
