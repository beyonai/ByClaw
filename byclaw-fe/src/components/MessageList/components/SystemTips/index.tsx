import styles from './index.module.less';

function SystemTips({ text }: { text?: string }) {
  if (!text) return null;

  return (
    <p className={styles.systemTips}>
      <span>{text}</span>
    </p>
  );
}

export default SystemTips;
