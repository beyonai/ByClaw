import React from 'react';
import classNames from 'classnames';
import { ClockCircleOutlined } from '@ant-design/icons';
import { Tag, Typography } from 'antd';
import { useIntl } from '@umijs/max';

import type { IVersionNotification } from '@/typescript/version';

import styles from './index.module.less';

function getBizTypeMeta(bizType?: number) {
  if (bizType === 2) {
    return { labelId: 'systemNotification.versionNotice', color: 'default' };
  }
  return null;
}

function VersionComp(props: { item: IVersionNotification }) {
  const intl = useIntl();
  const { item } = props;

  const bizType = getBizTypeMeta((item as IVersionNotification)?.bizType);
  const title = item.title || intl.formatMessage({ id: 'systemNotification.unnamedNotification' });

  return (
    <div className={classNames(styles.content, styles.versionContent)}>
      <div className={styles.titleRow}>
        <Typography.Text className={styles.title} ellipsis={{ tooltip: title }}>
          {title}
        </Typography.Text>
        <Tag icon={<ClockCircleOutlined />} className={styles.dateTag}>
          {item.createTime || '-'}
        </Tag>
        {bizType && (
          <Tag color={bizType.color} className={styles.priorityTag}>
            {intl.formatMessage({ id: bizType.labelId })}
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
