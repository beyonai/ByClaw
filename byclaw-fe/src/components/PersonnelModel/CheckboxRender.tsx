import React, { useMemo } from 'react';

import { useIntl } from '@umijs/max';
import { Checkbox, Tooltip } from 'antd';
import classnames from 'classnames';
import { getAgentChatAvatar } from '@/utils/agent';

import AntdIcon from '@/components/AntdIcon';
import { dataItemTypeMap } from './const';
import styles from './render.moudle.less';

function CheckboxRender(props) {
  const { item, itemKey, isSearch = false, onDrillOrg, disabled } = props;

  const intl = useIntl();

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
    if (item.type === dataItemTypeMap.user) {
      return <div className={styles.userAvatar}>{item.name?.slice(item.name?.length - 2, item.name.length)}</div>;
    }
    if (item.type === dataItemTypeMap.agent) {
      return <div style={{ height: '28px', width: '28px' }}>{getAgentChatAvatar(item?.chatAvatar)}</div>;
    }

    return (
      <div className={styles.orgAvatar}>
        <AntdIcon type={iconType} style={{ fontSize: 14 }} />
      </div>
    );
  }, [item.type, iconType]);

  return (
    <Checkbox value={item[itemKey]} disabled={item.disabled || disabled}>
      <div className={styles.item}>
        <div className={styles.name}>
          {iconReander}
          <div
            className={classnames(styles.nameTextWrap, {
              [styles.searchWrap]: isSearch,
            })}
          >
            <Tooltip title={item.name} placement="right">
              <div className={classnames(styles.nameText, styles.title)}>{item.name}</div>
            </Tooltip>
            {isSearch && (
              <Tooltip title={item.desc} placement="right">
                <div className={classnames(styles.nameText, styles.desc)}>{item.desc}</div>
              </Tooltip>
            )}
          </div>
        </div>
        {!isSearch && onDrillOrg && (
          <div className={styles.btnContainer}>
            <div
              className={styles.btn}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onDrillOrg(item);
              }}
            >
              {intl.formatMessage({ id: 'personnelModel.subordinate' })}
            </div>
          </div>
        )}
      </div>
    </Checkbox>
  );
}

export default React.memo(CheckboxRender);
