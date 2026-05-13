import React from 'react';
import AntdIcon from '@/components/AntdIcon';
import styles from './index.module.less';

export interface SectionHeaderProps {

  /** 标题文本 */
  title: string;

  /** 图标类型 */
  iconType: string;

  /** 头部背景色 */
  headerBackground?: string;

  /** 图标背景色 */
  iconBackground?: string;

  /** 更新时间，传了才显示 */
  updateTime?: string;

  /** 更新时间的格式化文本前缀 */
  updateTimePrefix?: string;
}

const SectionHeader: React.FC<SectionHeaderProps> = ({
  title,
  iconType,
  headerBackground,
  iconBackground,
  updateTime,
  updateTimePrefix,
}) => {
  return (
    <div className={styles.portraitHeader} style={headerBackground ? { background: headerBackground } : undefined}>
      <div className={styles.sectionTitle}>
        <div className={styles.sectionTitleIcon} style={iconBackground ? { background: iconBackground } : undefined}>
          <AntdIcon type={iconType} style={{ color: '#fff', fontSize: 16 }} />
        </div>
        {title}
      </div>
      {updateTime && (
        <div className={styles.updateTime}>
          {updateTimePrefix}
          {updateTime}
        </div>
      )}
    </div>
  );
};

export default SectionHeader;
