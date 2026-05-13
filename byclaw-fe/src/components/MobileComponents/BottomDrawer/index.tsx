import { Drawer } from 'antd';
import { noop } from 'lodash';
import React, { useMemo } from 'react';

import { DrawerProps } from 'antd/es/drawer/index';

import styles from './index.module.less';

type IProp = {
  renderButtons?: React.ReactNode;
  title?: React.ReactNode;
  keyName?: string;
  children?: React.ReactNode;
  onClose?: (e: any) => void;
} & Partial<DrawerProps>;

function BottomDrawer(props: IProp) {
  const { open, renderButtons = null, children, onClose = noop, title, size, rootClassName = '', ...rest } = props;

  const _rootClassName = useMemo(() => {
    let _classname = `${styles.wrapper}`;
    if (renderButtons) {
      _classname += ` ${styles.centerTitle}`;
    } else {
      _classname += ` ${styles.absoluteClose}`;
    }

    return _classname;
  }, [renderButtons]);

  return (
    <Drawer
      open={open}
      size={size || 'default'}
      onClose={onClose}
      placement="bottom"
      title={title}
      rootClassName={`${_rootClassName} ${rootClassName}`}
      extra={renderButtons}
      {...rest}
    >
      {children}
    </Drawer>
  );
}

export default BottomDrawer;
