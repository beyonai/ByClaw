import React from 'react';
import { Space, Button, Drawer } from 'antd';
import classname from 'classnames';
import { useIntl } from '@umijs/max';

/** Drawer that accepts Modal props */
const DrawerWithProps = (props) => {
  const intl = useIntl();

  const {
    title,
    width,
    visible,
    confirmLoading,
    onOk,
    onCancel,
    okButtonProps,
    cancelButtonProps,
    footer = true,
    children,
    drawerProps,
    hasOkButton = true,
    okText = intl.formatMessage({ id: 'common.confirm' }),
    cancelText = intl.formatMessage({ id: 'common.cancel' }),
    extraBtns,
    maskClosable = false,
    ...restProps
  } = props;

  const syncProps = {
    title,
    width,
    open: visible, // For antd version under 4.23.0
    // visible, // For antd version since 4.23.0
    onClose: onCancel,
    footer: footer && (
      <Space style={{ float: 'right' }}>
        <Button onClick={onCancel} {...cancelButtonProps}>
          {cancelText}
        </Button>
        {extraBtns}
        {hasOkButton && (
          <Button type="primary" onClick={onOk} {...{ loading: confirmLoading, ...okButtonProps }}>
            {okText}
          </Button>
        )}
      </Space>
    ),
    placement: 'right',
    ...restProps,
  };
  return (
    <Drawer
      {...syncProps}
      {...drawerProps}
      maskClosable={maskClosable}
      className={classname(restProps.className, 'custom-drawer')}
    >
      {children}
    </Drawer>
  );
};

export default DrawerWithProps;
