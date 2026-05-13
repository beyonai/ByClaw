import React from 'react';
import classNames from 'classnames';
import { Tabs } from 'antd';
import { useIntl } from '@umijs/max';
import SystemParams from './Params';
import SystemParamsStatics from './Statics';

import styles from './index.module.less';

export default function SystemParamsPage() {
  const intl = useIntl();

  return (
    <div style={{ padding: '0 16px' }} className="full-height">
      <Tabs
        items={[
          {
            label: intl.formatMessage({ id: 'SystemParams.paramsManagement' }),
            key: 'params',
            children: <SystemParams />,
          },
          {
            label: intl.formatMessage({ id: 'SystemParams.staticParams' }),
            key: 'statics',
            children: <SystemParamsStatics />,
          },
        ]}
        className={classNames(styles.tabs, 'ub ub-ver gap8 full-height')}
        tabBarStyle={{
          marginBottom: 0,
        }}
        destroyInactiveTabPane
      />
    </div>
  );
}
