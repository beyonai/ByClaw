import React from 'react';
import styles from './index.module.less';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title?: React.ReactNode;
  description?: React.ReactNode;
}

const EmptyTips: React.FC<EmptyStateProps> = (props) => {
  const { icon, title, description } = props;

  return (
    <div className={styles.emptyState}>
      {icon && <div className={styles.icon}>{icon}</div>}
      {title && <div className={styles.title}>{title}</div>}
      {description && <div className={styles.description}>{description}</div>}
    </div>
  );
};

export default EmptyTips;
