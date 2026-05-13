import React, { useState } from 'react';
import Icon from '@/components/AntdIcon/icon';
import { Modal } from 'antd';
import Search from '../header/components/Search';
import styles from './index.module.less';

export default function SiderSearch() {
  const [showSearch, setShowSearch] = useState(false);

  return (
    <>
      <div className={styles.sideIconWrap}>
        <Icon onClick={() => setShowSearch(true)} type="icon-a-Searchsousuo" className={styles.tabIcon} />
      </div>
      <Modal
        open={showSearch}
        title=""
        closable={false}
        onCancel={() => setShowSearch(false)}
        style={{ top: 32 }}
        styles={{
          header: { display: 'none' },
          footer: { display: 'none' },
          content: { padding: 16 },
        }}
        width="66vw"
      >
        <Search showSearch displayInModal setShowSearch={setShowSearch} className={styles.modalSearchWrap} />
      </Modal>
    </>
  );
}
