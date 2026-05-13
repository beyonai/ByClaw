// tslint:disable:ordered-imports
import React from 'react';
import classnames from 'classnames';
import { get } from 'lodash';

import styles from './index.module.less';

type IProps = {
  messageListItemContent: { substance: string };
};

export default function thinkSubTitle(props: IProps) {
  const text = get(props, 'messageListItemContent.substance', '');

  return (
    <div className={classnames(styles.thinkingTitle, 'ub ub-ac')}>
      <span className={styles.dot} />
      <div className={styles.titleText}>{text}</div>
    </div>
  );
}
