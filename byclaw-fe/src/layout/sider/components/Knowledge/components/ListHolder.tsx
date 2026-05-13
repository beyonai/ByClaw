import React from 'react';
import { Spin } from 'antd';
import styles from './common.module.less';

export default function ListHolder({
  id,
  loading,
  children,
}: {
  id: string;
  loading: boolean;
  children: React.ReactElement;
}) {
  return (
    <Spin spinning={loading} wrapperClassName={styles.listSpinner}>
      <div id={id} style={{ height: '100%', overflow: 'auto' }}>
        {children}
      </div>
    </Spin>
  );
}
