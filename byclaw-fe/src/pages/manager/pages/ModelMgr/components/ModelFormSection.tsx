import { DownOutlined, RightOutlined } from '@ant-design/icons';
import React from 'react';
import styles from './ModelFormModal.module.less';

type Props = {
  title: React.ReactNode;
  desc: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
};

const ModelFormSection: React.FC<Props> = ({ title, desc, open, onToggle, children }) => {
  return (
    <div className={styles.sectionCard}>
      <button type="button" className={styles.sectionHeader} onClick={onToggle}>
        <div className={styles.sectionTitle}>
          <span className={styles.sectionBar} />
          {title}
        </div>
        <span className={styles.sectionAction}>{open ? <DownOutlined /> : <RightOutlined />}</span>
      </button>
      <div className={styles.sectionDesc}>{desc}</div>
      <div style={{ display: open ? 'block' : 'none' }}>{children}</div>
    </div>
  );
};

export default ModelFormSection;
