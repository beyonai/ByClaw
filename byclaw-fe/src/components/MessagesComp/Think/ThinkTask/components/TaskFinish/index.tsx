import { CheckCircleOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import classnames from 'classnames';
import React from 'react';

import styles from './index.module.less';

type IProps = {
  headerBlock: React.ReactNode;
  onClick: () => void;
};

export default function TaskFinish(props: IProps) {
  const { headerBlock, onClick } = props;

  const intl = useIntl();

  return (
    <div className={classnames(styles.cardContainer, 'pointer')} onClick={onClick}>
      {headerBlock}
      <div className={styles.cardFooter}>
        <span className={styles.status}>
          <CheckCircleOutlined className={styles.statusIcon} />
          {intl.formatMessage({ id: 'taskFinish.taskFinish' })}
        </span>
        <span className={styles.detailLink}>
          {intl.formatMessage({ id: 'common.detail' })} <span className={styles.arrow}>→</span>
        </span>
      </div>
    </div>
  );
}
