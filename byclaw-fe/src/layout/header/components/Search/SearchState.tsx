import React from 'react';
import { Empty, Spin } from 'antd';
import styles from './index.module.less';

interface Props {
  intl: {
    formatMessage: (descriptor: { id: string }) => string;
  };
}

const emptyStyle = {
  height: '60vh',
};

export const SearchEmpty = ({ intl }: Props) => (
  <div className={styles.empty} style={emptyStyle}>
    <Empty
      image="https://gw.alipayobjects.com/zos/antfincdn/ZHrcdLPrvN/empty.svg"
      styles={{ image: { height: 80 } }}
      description={<span className={styles.noContent}>{intl.formatMessage({ id: 'workCenter.noContent' })}</span>}
    />
  </div>
);

export const SearchLoading = ({ intl }: Props) => (
  <div className={styles.empty} style={emptyStyle}>
    <Spin spinning tip={intl.formatMessage({ id: 'common.querying' })} size="large">
      <div className={styles.loadingContent} />
    </Spin>
  </div>
);
