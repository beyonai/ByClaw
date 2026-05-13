import React from 'react';

import { CloseOutlined, MenuUnfoldOutlined, MenuFoldOutlined } from '@ant-design/icons';
import { Space, Button } from 'antd';
import classnames from 'classnames';

import AntdIcon from '@/components/AntdIcon';
import { Resizable, isLength, transformLength } from '@/components/Resizable';
import { INIT_DRAWER_CFG } from './useEventEmitter';

import useAppStore from '@/models/common/useAppStore';

import styles from './index.module.less';

type IMyDrawerProps = {
  children?: any;
  onClose?: () => void;
  onFullScreen?: () => void;
  open: boolean;
  drawerCfg: typeof INIT_DRAWER_CFG;
  closeContent: boolean;
  setCloseContent: (closeContent: boolean) => void;
};

const MyDrawer = (props: IMyDrawerProps) => {
  const { children, onClose, open, onFullScreen, closeContent, setCloseContent } = props;
  const { drawerCfg } = props;

  const { isSiderCollapsed, setSiderCollapsed } = useAppStore();

  const showHeader = React.useMemo(() => {
    return drawerCfg?.title || drawerCfg?.canClose || drawerCfg?.canFullScreen || drawerCfg?.canCloseContent;
  }, [drawerCfg]);

  const w = React.useMemo(() => {
    if (open) {
      if (closeContent && drawerCfg.canCloseContent) {
        return '100%';
      }

      if (isLength(drawerCfg.width)) {
        const width = transformLength(drawerCfg.width);

        if (isLength(drawerCfg.minWidth) && width < transformLength(drawerCfg.minWidth)) {
          return drawerCfg.minWidth;
        }
        if (isLength(drawerCfg.maxWidth) && width > transformLength(drawerCfg.maxWidth)) {
          return drawerCfg.maxWidth;
        }
      }

      return drawerCfg.width;
    }
    return '0';
  }, [open, drawerCfg.width, drawerCfg.minWidth, drawerCfg.maxWidth, closeContent, drawerCfg.canCloseContent]);

  const drawer = (
    <div
      style={{
        width: w,
        minWidth: open ? drawerCfg?.minWidth : '0',
        // maxWidth: drawerCfg?.maxWidth,
      }}
      className={classnames(styles.myDrawer, {
        [styles.opening]: open,
        // [styles.closing]: !open,
      })}
    >
      <div className="ub ub-ver full-height">
        {showHeader && (
          <div className={classnames(styles.header, 'ub')}>
            <div className="ub ub-ac ub-f1 gap4">
              {isSiderCollapsed && (
                <MenuUnfoldOutlined
                  onClick={() => {
                    setSiderCollapsed(false);
                  }}
                />
              )}
              {!isSiderCollapsed && (
                <MenuFoldOutlined
                  onClick={() => {
                    setSiderCollapsed(true);
                  }}
                />
              )}
              {drawerCfg?.title && <div className="ellipsis ub-f1">{drawerCfg?.title}</div>}
            </div>
            <div style={{ marginLeft: 'auto' }}>
              <Space>
                {drawerCfg?.canFullScreen && (
                  <Button
                    type="text"
                    icon={<AntdIcon type="icon-a-Full-screen-onequanjufangda1" />}
                    className={classnames(styles.icon)}
                    onClick={() => onFullScreen?.()}
                  />
                )}
                {drawerCfg?.canCloseContent && (
                  <>
                    {closeContent && (
                      <Button
                        type="text"
                        icon={<AntdIcon type="icon-a-Collapse-text-inputshouqiwenbenyu" />}
                        className={classnames(styles.icon)}
                        onClick={() => setCloseContent(false)}
                      />
                    )}
                    {!closeContent && (
                      <Button
                        type="text"
                        icon={<AntdIcon type="icon-a-Expand-text-inputzhankaiwenbenyu" />}
                        className={classnames(styles.icon)}
                        onClick={() => setCloseContent(true)}
                      />
                    )}
                  </>
                )}
                {drawerCfg?.canClose && (
                  <Button
                    type="text"
                    icon={<CloseOutlined />}
                    className={classnames(styles.icon)}
                    onClick={() => onClose?.()}
                  />
                )}
              </Space>
            </div>
          </div>
        )}
        <div className="ub-f1 overflow-auto hideThumb">{children}</div>
      </div>
    </div>
  );
  return (
    <Resizable right disabled={closeContent} limit={{ minWidth: drawerCfg.minWidth, maxWidth: drawerCfg.maxWidth }}>
      {drawer}
    </Resizable>
  );
};

export default MyDrawer;
