import styles from './index.module.less';

const DividerTips = ({ text, style }: { text?: string; style?: React.CSSProperties }) => {
  if (!text) return null;

  return (
    <p className={styles.dividerTips} style={style}>
      <span>{text}</span>
    </p>
  );
};

export default DividerTips;
