import React from 'react';
import classNames from 'classnames';
import styles from './style.module.less';

export default function RecordingIcon({ classname }: { classname?: string }) {
  return (
    <div className={classNames(styles.wrap, classname)}>
      <div className={styles.block}>
        <span className={styles.pillar} />
        <span className={styles.pillar} />
        <span className={styles.pillar} />
        <span className={styles.pillar} />
        <span className={styles.pillar} />
      </div>
    </div>
  );
}
