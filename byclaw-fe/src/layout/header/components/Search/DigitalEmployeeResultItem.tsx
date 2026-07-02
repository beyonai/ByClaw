import React from 'react';
import RenderRightTop from '@/pages/digitalEmployees/components/AllDigitalEmployees/RenderRightTop';
import { getAvatarUrl } from '@/utils/agent';
import styles from './index.module.less';

interface Props {
  item: any;
  highlight: (text: string) => React.ReactNode;
  onClick: (item: any) => void;
}

const DigitalEmployeeResultItem = ({ item, highlight, onClick }: Props) => (
  <div className={styles.itemBox} key={item.id} onClick={() => onClick(item)}>
    <div className={styles.itemEmployeeImgBox}>
      <img className={styles.itemEmployeeImg} src={getAvatarUrl(item.avatar)} alt="" />
    </div>
    <div className={styles.itemContent}>
      <div className={styles.renderRightTop}>
        <RenderRightTop employee={item} />
      </div>
      <span className={styles.itemTitle}>{highlight(item.name)}</span>
      <span className={styles.itemDesc}>{highlight(item.resourceDesc)}</span>
    </div>
  </div>
);

export default DigitalEmployeeResultItem;
