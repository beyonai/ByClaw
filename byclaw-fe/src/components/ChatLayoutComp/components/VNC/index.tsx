import { Button } from 'antd';
import DesktopOutlined from '@ant-design/icons/DesktopOutlined';
import useDesktopEntry, { type DesktopEntryProps } from './useDesktopEntry';
import styles from './index.module.less';

export default function VNC(props: DesktopEntryProps) {
  const { openDesktop, count, preparing } = useDesktopEntry(props);
  if (!openDesktop) return null;

  return (
    <Button
      type="text"
      onClick={openDesktop}
      title="远程桌面"
      aria-label={`远程桌面${count ? ` ${count}` : ''}${preparing ? ' · 正在准备' : ''}`}
    >
      <DesktopOutlined />
      <span>远程桌面</span>
      {count > 0 && (
        <span className={styles.count} aria-hidden="true">
          {count > 99 ? '99+' : count}
        </span>
      )}
      {preparing ? ' · 正在准备' : ''}
    </Button>
  );
}
