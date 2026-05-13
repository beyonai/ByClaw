import styles from './index.module.less';

const DividerTips = ({ text }: { text?: string }) => {
  if (!text) return null;

  return (
    <p className={styles.dividerTips}>
      <span>{text}</span>
    </p>
  );
};

export default DividerTips;
