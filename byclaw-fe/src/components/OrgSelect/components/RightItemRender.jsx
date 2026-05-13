import { useMemo } from 'react';

import AntdIcon from '@/components/AntdIcon';
import ChatAvatar from '@/components/ChatAvatar';
import { dataItemTypeMap } from '../const';
import styles from './render.module.less';

const ItemRenderRight = ({ item }) => {
  const IconRender = useMemo(() => {
    let iconType = 'icon-a-Localyidingwei';

    if (item.type === dataItemTypeMap.session) {
      return <ChatAvatar session={item} size={14} />;
    }

    if (item.type === dataItemTypeMap.org) {
      iconType = 'icon-a-Chart-graphguanxitu';
    }
    // TODO: 数字员工有独立图标后再拆分
    if ([dataItemTypeMap.post, dataItemTypeMap.agent].includes(item.type)) {
      iconType = 'icon-a-Addtianjia';
    }

    return <AntdIcon type={iconType} style={{ fontSize: 14 }} />;
  }, [item]);

  return (
    <div className={styles.rightItem}>
      {item.type === dataItemTypeMap.user ? (
        <div className={styles.userAvatar}>{item.name?.slice(item.name?.length - 2, item.name.length)}</div>
      ) : (
        <div className={styles.orgAvatar}>{IconRender}</div>
      )}
      <div className={styles.nameTextRight} title={item.name}>
        {item.name}
      </div>
    </div>
  );
};

export default ItemRenderRight;
