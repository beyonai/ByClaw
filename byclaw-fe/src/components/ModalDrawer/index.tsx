import React from 'react';
import { Button, Drawer, Modal } from 'antd';
import classnames from 'classnames';
import { getIntl } from '@umijs/max';
import styles from './index.module.less';
import type { ButtonProps } from 'antd/es/button';
import type { DrawerProps } from 'antd/es/drawer';

export interface ModalDrawerProps extends DrawerProps {
  width?: number;
  children: React.ReactNode;
  onOk?: () => void;
  onCancel?: () => void;
  confirmLoading?: boolean;
  okButtonProps?: ButtonProps;
  footerRender?: React.ReactNode;
  okText?: string;
  cancelText?: string;
  className?: string;
  showOkButton?: boolean;
  showFoot?: boolean;
  type?: string;
  contentClass?: string;
  paddingSize?: 'padding-middle' | 'padding-small' | 'padding-none';
}

const ModalDrawer = (props: ModalDrawerProps) => {
  const {
    width = 720,
    children,
    onOk = () => {},
    onCancel = () => {},
    confirmLoading = false,
    okButtonProps = {},
    footerRender = null,
    okText = getIntl().formatMessage({ id: 'common.confirm' }),
    cancelText = getIntl().formatMessage({ id: 'common.cancel' }),
    className = '',
    showOkButton = true,
    showFoot = true,
    type = 'drawer',
    paddingSize = 'padding-middle',
    contentClass,
    ...restProps
  } = props;
  const _width = Math.min(window.innerWidth - 20, width);
  let footerButtons = footerRender;
  if (!footerButtons) {
    footerButtons = (
      <div>
        <Button onClick={onCancel} data-reg-id="ModalDrawer.cancel">
          {cancelText}
        </Button>
        {showOkButton && (
          <Button
            disabled={confirmLoading}
            loading={confirmLoading}
            type="primary"
            onClick={onOk}
            data-reg-id="ModalDrawer.ok"
            {...okButtonProps}
          >
            {okText}
          </Button>
        )}
      </div>
    );
  }
  const Comp: any = type === 'modal' ? Modal : Drawer;
  return (
    <Comp
      width={_width}
      className={classnames(
        styles.modalDrawer,
        { [styles.modal]: type === 'modal' },
        className
      )}
      destroyOnClose
      confirmLoading={confirmLoading}
      {...restProps}
      okButtonProps={okButtonProps}
      onClose={onCancel}
      onCancel={onCancel}
      onOk={onOk}
    >
      <div
        className={classnames(
          styles.modalDrawerContent,
          {
            [styles.hasfoot]: showFoot,
            [styles[paddingSize]]: true,
          },
          contentClass
        )}
      >
        {children}
      </div>
      {showFoot && (
        <div className={styles.modalDrawerBottomBar}>{footerButtons}</div>
      )}
    </Comp>
  );
};

export default ModalDrawer;
