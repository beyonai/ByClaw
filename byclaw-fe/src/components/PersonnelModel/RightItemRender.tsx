import { useMemo } from 'react';

import { Tooltip } from 'antd';

import AntdIcon from '@/components/AntdIcon';
import ChatAvatar from '@/components/ChatAvatar';
import { dataItemTypeMap } from './const';
import styles from './render.moudle.less';

const RightItemRender = ({ item }: { item: any }) => {
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
      <Tooltip title={item.name} placement="top">
        <div className={styles.nameTextRight}>{item.name}</div>
      </Tooltip>
    </div>
  );
};

export default RightItemRender;
