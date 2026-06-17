import React from 'react';
import { ClockCircleOutlined } from '@ant-design/icons';
import { Tag, Typography } from 'antd';
import { isNil } from 'lodash';
import { useIntl } from '@umijs/max';

import { INotificationItem } from './index';

import styles from './index.module.less';

type PriorityMeta = { labelId?: string; label?: string; color: string };

const priorityMap: Record<string, PriorityMeta> = {
  '1': { labelId: 'systemNotification.priority.low', color: 'default' },
  '2': { labelId: 'systemNotification.priority.medium', color: 'processing' },
  '3': { labelId: 'systemNotification.priority.high', color: 'warning' },
  '4': { labelId: 'systemNotification.priority.urgent', color: 'error' },
};

function getPriorityMeta(priority?: string | number) {
  if (isNil(priority)) {
    return null;
  }
  return (
    priorityMap[String(priority)] || {
      labelId: priority ? undefined : 'systemNotification.priority.unset',
      label: priority ? `P${priority}` : undefined,
      color: 'default',
    }
  );
}

function NotificationComp(props: { item: INotificationItem }) {
  const intl = useIntl();
  const { item } = props;

  const priorityMeta = getPriorityMeta(item.priority);
  const title = item.title || intl.formatMessage({ id: 'systemNotification.unnamedNotification' });

  return (
    <div className={styles.content}>
      <div className={styles.titleRow}>
        <Typography.Text className={styles.title} ellipsis={{ tooltip: title }}>
          {title}
        </Typography.Text>
        <Tag icon={<ClockCircleOutlined />} className={styles.dateTag}>
          {item.createTime || '-'}
        </Tag>
        {priorityMeta && (
          <Tag color={priorityMeta.color} className={styles.priorityTag}>
            {priorityMeta.labelId ? intl.formatMessage({ id: priorityMeta.labelId }) : priorityMeta.label}
          </Tag>
        )}
      </div>
      <Typography.Paragraph
        className={styles.desc}
        ellipsis={{ rows: 2, tooltip: { title: item.content, placement: 'topLeft' } }}
      >
        {item.content || '-'}
      </Typography.Paragraph>
    </div>
  );
}

export default NotificationComp;
