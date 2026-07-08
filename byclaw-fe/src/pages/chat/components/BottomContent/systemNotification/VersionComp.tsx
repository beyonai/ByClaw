import React from 'react';
import classNames from 'classnames';
import { Tag, Typography } from 'antd';
import { isNil } from 'lodash';
import { useIntl } from '@umijs/max';

import type { IVersionNotification } from '@/typescript/version';

import styles from './index.module.less';

function getBizTypeMeta(bizType?: number) {
  if (bizType === 2) {
    return { labelId: 'systemNotification.versionNotice', tone: 'blue' };
  }
  return null;
}

function isUnread(value: unknown) {
  if (isNil(value)) {
    return false;
  }
  if (typeof value === 'boolean') {
    return !value;
  }
  return ['0', 'false', 'unread', 'n'].includes(String(value).toLowerCase());
}

function VersionComp(props: { item: IVersionNotification }) {
  const intl = useIntl();
  const { item } = props;

  const bizType = getBizTypeMeta((item as IVersionNotification)?.bizType);
  const title = item.title || intl.formatMessage({ id: 'systemNotification.unnamedNotification' });
  const unread = isUnread((item as IVersionNotification & { isRead?: string | number | boolean })?.isRead);

  return (
    <div className={classNames(styles.content, styles.versionContent, { [styles.unreadContent]: unread })}>
      {/* <span className={styles.unreadDot} /> */}
      <div className={styles.titleRow}>
        <Typography.Text className={styles.title} ellipsis={{ tooltip: title }}>
          {title}
        </Typography.Text>
        {bizType && (
          <Tag color="processing" className={styles.priorityTag}>
            {intl.formatMessage({ id: bizType.labelId })}
          </Tag>
        )}
        <span className={styles.dateText}>{item.createTime || '-'}</span>
      </div>
      {/* <Typography.Paragraph
        className={styles.desc}
        ellipsis={{ rows: 2, tooltip: { title: item.content, placement: 'topLeft' } }}
      >
        {item.content || '-'}
      </Typography.Paragraph> */}
    </div>
  );
}

export default VersionComp;
