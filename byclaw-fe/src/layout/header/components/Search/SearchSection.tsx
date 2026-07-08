import React from 'react';
import AntdIcon from '@/components/AntdIcon';
import styles from './index.module.less';

interface Props {
  title: React.ReactNode;
  data: any[];
  renderItem: (item: any) => React.ReactNode;
  renderList: (list: any[], renderItem: (item: any) => React.ReactNode, className?: string) => React.ReactNode;
  listClassName?: string;
  viewMoreText: string;
  onViewMore: (title: React.ReactNode) => void;
}

const SearchSection = ({ title, data, renderItem, renderList, listClassName, viewMoreText, onViewMore }: Props) =>
  (data || []).length ? (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionTitle}>{title}</span>
        {data.length > 3 && (
          <div className={styles.sectionMore} onClick={() => onViewMore(title)}>
            <span className={styles.sectionMorespan}>{viewMoreText}</span>
            <AntdIcon type="icon-a-Rightyou" className={styles.sectionMoreImg} />
          </div>
        )}
      </div>
      <div>{renderList(data.slice(0, 3), renderItem, listClassName)}</div>
    </div>
  ) : null;

export default SearchSection;
