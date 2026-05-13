import React, { useMemo } from 'react';

import { Checkbox, Tooltip } from 'antd';
import classnames from 'classnames';
import AntdIcon from '@/components/AntdIcon';
import { dataItemTypeMap } from '../const';
import { IOrgCache } from '@/components/OrgSelect/MyOrgSelect';

import styles from './render.module.less';

type IProps = {
  item: IOrgCache;
  disabled?: boolean;
};

function CheckboxRender(props: IProps) {
  const { item, disabled } = props;

  const iconType = useMemo(() => {
    if (item.type === dataItemTypeMap.org) {
      return 'icon-a-Chart-graphguanxitu';
    }
    // TODO: 数字员工有独立图标后再拆分
    if ([dataItemTypeMap.post, dataItemTypeMap.agent].includes(item.type)) {
      return 'icon-a-Addtianjia';
    }
    return 'icon-a-Localyidingwei';
  }, [item]);

  const iconReander = useMemo(() => {
    return (
      <div className={styles.orgAvatar}>
        <AntdIcon type={iconType} style={{ fontSize: 14 }} />
      </div>
    );
  }, [item.type, iconType]);

  return (
    <Checkbox value={item.id} disabled={item.disabled || disabled} key={item.id} className="full-width full-height">
      <div className={classnames(styles.item, 'full-width')}>
        <div className={classnames(styles.name, 'ub ub-ac gap8 full-width')}>
          {iconReander}
          <div className={classnames(styles.nameTextWrap, 'ub-f1')}>
            <Tooltip title={item.name} placement="right">
              <div className={classnames(styles.nameText, 'ellipsis')}>{item.name}</div>
            </Tooltip>
          </div>
        </div>
      </div>
    </Checkbox>
  );
}

export default React.memo(CheckboxRender);
