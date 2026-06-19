import React from 'react';
import classNames from 'classnames';
import { ClockCircleOutlined } from '@ant-design/icons';
import { Tag, Typography } from 'antd';

import type { IVersionNotification } from '@/typescript/version';

import styles from './index.module.less';

function getBizTypeMeta(bizType?: number) {
  if (bizType === 2) {
    return { label: '版本通知', color: 'default' };
  }
  return null;
}

function VersionComp(props: { item: IVersionNotification }) {
  const { item } = props;

  const bizType = getBizTypeMeta((item as IVersionNotification)?.bizType);

  return (
    <div className={classNames(styles.content, styles.versionContent)}>
      <div className={styles.titleRow}>
        <Typography.Text className={styles.title} ellipsis={{ tooltip: item.title }}>
          {item.title || '未命名通知'}
        </Typography.Text>
        <Tag icon={<ClockCircleOutlined />} className={styles.dateTag}>
          {item.createTime || '-'}
        </Tag>
        {bizType && (
          <Tag color={bizType.color} className={styles.priorityTag}>
            {bizType.label}
          </Tag>
        )}
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
