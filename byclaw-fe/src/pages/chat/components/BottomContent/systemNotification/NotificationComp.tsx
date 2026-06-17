import React from 'react';
import { ClockCircleOutlined } from '@ant-design/icons';
import { Tag, Typography } from 'antd';
import { isNil } from 'lodash';

import { INotificationItem } from './index';

import styles from './index.module.less';

const priorityMap: Record<string, { label: string; color: string }> = {
  '1': { label: '低', color: 'default' },
  '2': { label: '中', color: 'processing' },
  '3': { label: '高', color: 'warning' },
  '4': { label: '紧急', color: 'error' },
};

function getPriorityMeta(priority?: string | number) {
  if (isNil(priority)) {
    return null;
  }
  return priorityMap[String(priority)] || { label: priority ? `P${priority}` : '未设', color: 'default' };
}

function NotificationComp(props: { item: INotificationItem }) {
  const { item } = props;

  const priorityMeta = getPriorityMeta(item.priority);

  return (
    <div className={styles.content}>
      <div className={styles.titleRow}>
        <Typography.Text className={styles.title} ellipsis={{ tooltip: item.title }}>
          {item.title || '未命名通知'}
        </Typography.Text>
        <Tag icon={<ClockCircleOutlined />} className={styles.dateTag}>
          {item.createTime || '-'}
        </Tag>
        {priorityMeta && (
          <Tag color={priorityMeta.color} className={styles.priorityTag}>
            {priorityMeta.label}
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
