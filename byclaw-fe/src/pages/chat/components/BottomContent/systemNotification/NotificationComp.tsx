import React from 'react';
import { Tag, Typography } from 'antd';
import { isNil } from 'lodash';
import { useIntl } from '@umijs/max';
import classNames from 'classnames';

import { INotificationItem } from './index';

import styles from './index.module.less';

type PriorityMeta = { labelId?: string; label?: string; tone: string };

const priorityMap: Record<string, PriorityMeta> = {
  '1': { labelId: 'systemNotification.priority.low', tone: 'default' },
  '2': { labelId: 'systemNotification.priority.medium', tone: 'success' },
  '3': { labelId: 'systemNotification.priority.high', tone: 'warning' },
  '4': { labelId: 'systemNotification.priority.urgent', tone: 'error' },
};

function getPriorityMeta(priority?: string | number) {
  if (isNil(priority)) {
    return null;
  }
  return (
    priorityMap[String(priority)] || {
      labelId: priority ? undefined : 'systemNotification.priority.unset',
      label: priority ? `P${priority}` : undefined,
      tone: 'default',
    }
  );
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

function NotificationComp(props: { item: INotificationItem }) {
  const intl = useIntl();
  const { item } = props;

  const priorityMeta = getPriorityMeta(item.priority);
  const title = item.title || intl.formatMessage({ id: 'systemNotification.unnamedNotification' });
  const unread = isUnread(item.isRead);

  return (
    <div className={classNames(styles.content, { [styles.unreadContent]: unread })}>
      {/* <span className={styles.unreadDot} /> */}
      <div className={styles.titleRow}>
        <Typography.Text className={styles.title} ellipsis={{ tooltip: title }}>
          {title}
        </Typography.Text>
        {priorityMeta && (
          <Tag color={priorityMeta.tone} className={styles.priorityTag}>
            {priorityMeta.labelId ? intl.formatMessage({ id: priorityMeta.labelId }) : priorityMeta.label}
          </Tag>
        )}
        <span className={styles.dateText}>{item.createTime || '-'}</span>
      </div>
    </div>
  );
}

export default NotificationComp;
