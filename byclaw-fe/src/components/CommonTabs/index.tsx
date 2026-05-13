import React from 'react';
import { Tabs } from 'antd';
import type { TabsProps } from 'antd';
import styles from './index.module.less';
import classNames from 'classnames';

type CommonTabsProps = TabsProps

const CommonTabs: React.FC<CommonTabsProps> = ({ className, size = 'large', ...rest }) => {
  return <Tabs className={classNames(styles.tabs, className)} size={size} {...rest} />;
};

export default CommonTabs;
