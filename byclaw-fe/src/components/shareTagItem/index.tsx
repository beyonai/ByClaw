import AntdIcon from '@/components/AntdIcon';
import { CloseCircleFilled } from '@ant-design/icons';
import { Tag } from 'antd';
import React from 'react';
import styles from './index.module.less';

function ShareTagItem(props: {
  item: any;
  closable?: boolean;
  onClose?: () => void;
}) {
  const { item, closable, onClose } = props;
  const { label, type } = item;
  const onPreventMouseDown = (event: React.MouseEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };
  return (
    <Tag
      color="#F2F6FA"
      onMouseDown={onPreventMouseDown}
      closable={closable}
      onClose={onClose}
      className={styles.userTag}
      closeIcon={<CloseCircleFilled />}
    >
      {type === 'ORG' && (
        <span className={styles.userHead}>
          <AntdIcon type="icon-zuzhitubiao" style={{ fontSize: 20 }} />
        </span>
      )}
      {type === 'POST' && (
        <div className={styles.orgAvatar}>
          <AntdIcon type="icon-a-Addtianjia" style={{ fontSize: 14 }} />
        </div>
      )}
      {type === 'USER' && (
        <span className={styles.userHead}>
          {label.substring(label.length - 2, label.length)}
        </span>
      )}
      {label}
    </Tag>
  );
}

export default ShareTagItem;
