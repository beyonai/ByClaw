import { HourglassOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import classnames from 'classnames';
import React from 'react';

import styles from './index.module.less';

type IProps = {
  headerBlock: React.ReactNode;
  onClick: () => void;
};

export default function TaskLoading(props: IProps) {
  const { headerBlock, onClick } = props;

  const intl = useIntl();

  return (
    <div className={classnames(styles.card, 'pointer')} onClick={onClick}>
      {headerBlock}
      <div className={styles.statusRow}>
        <HourglassOutlined className={styles.hourglass} />
        <span className={styles.statusText}>{intl.formatMessage({ id: 'taskLoading.taskLoading' })}</span>
      </div>
      <div className={styles.progressBar} />
    </div>
  );
}
