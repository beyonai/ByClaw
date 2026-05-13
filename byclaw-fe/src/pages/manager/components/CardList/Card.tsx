import classnames from 'classnames';
import React from 'react';
import styles from './index.module.less';
import { PlusOutlined } from '@ant-design/icons';

export default function AddCard({
  onAdd,
}: {
  onAdd: () => void; // 新增卡片
}) {
  return (
    <div
      className={classnames(styles.cardItem, styles.addCard)}
      onClick={() => {
        onAdd();
      }}
    >
      <div className={styles.addItem}>
        <PlusOutlined />
        <div>新增</div>
      </div>
    </div>
  );
}
