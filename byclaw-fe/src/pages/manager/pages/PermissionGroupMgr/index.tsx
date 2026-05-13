import React, { useState, useMemo } from 'react';

import { Tabs } from 'antd';
import { useIntl } from '@umijs/max';

import SystemCharacterTree from './SystemCharacterTree';
import PostInfo from './PostInfo';

import styles from './index.less';
import classNames from 'classnames';

const PermissionGroupMgr: React.FC = () => {
  const intl = useIntl();

  const [selectedTabKey, setSelectedTabKey] = useState<string>('systemCharacter');

  const [infoLook, setInfoLook] = useState({}); // 详细信息-列表面板

  const leftTabItems = useMemo(
    () => [
      {
        key: 'systemCharacter',
        label: intl.formatMessage({ id: 'permissionGroupMgr.tree.systemCharacter' }),
        children: <SystemCharacterTree onLeafSelect={(key: any) => setInfoLook(key)} />,
      },
    ],
    [intl]
  );

  const rightTabItems = useMemo(
    () => [
      {
        key: 'systemCharacter',
        label: intl.formatMessage({ id: 'permissionGroupMgr.tree.systemCharacter' }),
        children: <PostInfo infoLook={infoLook} />,
      },
    ],
    [infoLook, intl]
  );

  return (
    <div className={styles.permissionGroupMgr}>
      <div className={classNames(styles.leftPane, 'ub ub-ver gap8')}>
        <Tabs
          activeKey={selectedTabKey}
          onChange={(key) => setSelectedTabKey(key)}
          tabBarStyle={{ display: 'none' }}
          className={classNames('ub-f1', styles.tabs)}
          items={leftTabItems}
        />
      </div>
      <div className={styles.rightPane}>
        <Tabs
          activeKey={selectedTabKey}
          onChange={(key) => setSelectedTabKey(key)}
          tabBarStyle={{ display: 'none' }}
          className={classNames(styles.tabs, 'full-height full-width')}
          items={rightTabItems}
        />
      </div>
    </div>
  );
};

export default PermissionGroupMgr;
