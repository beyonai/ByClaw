import { ArrowsAltOutlined, CloseOutlined } from '@ant-design/icons';
import React, { lazy, Suspense, useMemo, useRef } from 'react';
import { Space } from 'antd';
import classnames from 'classnames';

import useGlobal from '@/hooks/useGlobal';
import { getRandomNumber } from '@/utils/math';
import useActionEffect, { INIT_DRAWER_CFG } from './useEventEmitter';

import IframeRender from '@/components/MessagesComp/Iframe/IframeRender';

import { IMessage } from '@/typescript/message';

import styles from './index.module.less';
import { Resizable } from '../Resizable';

const FragmentComp = () => null;
const Mobile = lazy(() => import('@/pages/mobile/AuthPage'));
const PreViewFile = React.lazy(() =>
  import('@/components/Preview/Twins').then((module) => ({ default: module.PreViewFile }))
);

const MyPreViewFile = (props: Record<string, unknown>) => {
  return (
    <div className="ub fulle-width full-height">
      <React.Suspense>
        <PreViewFile {...props} />
      </React.Suspense>
    </div>
  );
};

export type IDrawerMessage = Partial<IMessage> & {
  messageId: string;
};

type IMyDrawerProps = {
  children?: any;
  onClose: () => void;
  onFullScreen: () => void;
  open: boolean;
  drawerCfg: Partial<typeof INIT_DRAWER_CFG>;
  drawerType?: string;
};

const MyDrawer = (props: IMyDrawerProps) => {
  const { children, onClose, open, onFullScreen } = props;
  const { drawerCfg, drawerType } = props;
  const canFullScreen = drawerCfg?.canFullScreen && drawerType !== 'preview';

  const showHeader = useMemo(() => {
    return drawerCfg?.title || drawerCfg?.canClose || canFullScreen;
  }, [canFullScreen, drawerCfg]);

  const drawer = (
    <div
      style={{
        width: open ? drawerCfg?.width : '0',
        minWidth: open ? drawerCfg?.minWidth : '0',
        maxWidth: drawerCfg?.maxWidth,
      }}
      className={classnames(styles.myDrawer, {
        [styles.opening]: open,
        [styles.closing]: !open,
        [styles.overlay]: drawerCfg?.overlay,
      })}
    >
      <div className="ub ub-ver full-height">
        {showHeader && (
          <div className={classnames(styles.header, 'ub ub-ac')}>
            {drawerCfg?.title && (
              <div className="ellipsis ub-f1" style={{ fontWeight: 500, fontSize: 15 }}>
                {drawerCfg?.title}
              </div>
            )}
            <div style={{ marginLeft: 'auto' }}>
              <Space>
                {drawerCfg?.canClose && (
                  <div className={classnames('pointer ub ub-ac ub-pc', styles.icon)} onClick={() => onClose()}>
                    <CloseOutlined />
                  </div>
                )}
                {canFullScreen && (
                  <div className={classnames('pointer ub ub-ac ub-pc', styles.icon)} onClick={() => onFullScreen()}>
                    <ArrowsAltOutlined />
                  </div>
                )}
              </Space>
            </div>
          </div>
        )}
        <div className="ub-f1 overflow-auto hideThumb">{children}</div>
      </div>
    </div>
  );
  // 覆盖式抽屉不参与 Flex 布局，避免账号登录时挤压左侧项目列表和露出后面的会话页。
  if (drawerCfg?.overlay) return drawer;
  return (
    <Resizable left limit={{ minWidth: drawerCfg.minWidth, maxWidth: drawerCfg.maxWidth }}>
      {drawer}
    </Resizable>
  );
};

function MainDrawer() {
  const { EventEmitter } = useGlobal();

  const keyRef = useRef(getRandomNumber(0, 100));

  const {
    drawerCfg,
    drawerType,
    contentPayload,

    driverOpen,
  } = useActionEffect();

  const ContentComp = React.useMemo<React.ComponentType<any>>(() => {
    keyRef.current = getRandomNumber(0, 100);
    if (['iframe', 'vnc'].includes(drawerType)) {
      return IframeRender;
    }
    if (drawerType === 'mobile') {
      return Mobile;
    }

    if (drawerType === 'preview') {
      return MyPreViewFile;
    }

    return FragmentComp;
  }, [drawerType]);

  const ContentElement = React.useMemo(() => {
    if (React.isValidElement(drawerType)) {
      return drawerType;
    }
    return null;
  }, [drawerType]);

  return (
    <MyDrawer
      open={!!drawerType}
      onClose={() => {
        driverOpen('');
      }}
      drawerCfg={drawerCfg}
      drawerType={drawerType}
      onFullScreen={() => {
        EventEmitter.emit('beyond-fullscreen-modal-message', {
          ...(contentPayload || {}),
        });
        EventEmitter.emit('beyond-fullscreen-modal-open-type', drawerType);
        driverOpen('');
      }}
    >
      <div className="full-width full-height overflow-hidden">
        <Suspense fallback="loading...">
          {ContentElement}
          <ContentComp
            key={keyRef.current}
            {...(contentPayload || {})}
            onClose={() => driverOpen('')}
            onUpdateMessage={(payload: IDrawerMessage) => {
              if (!payload.messageId) return;
              console.log('onUpdateMessage', payload);
              EventEmitter.emit('beyond-update-message', {
                message: payload,
                opt: {},
              });
            }}
            onCreateMessage={(payload: IDrawerMessage) => {
              console.log('onCreateMessage', payload);
              EventEmitter.emit('beyond-create-message', {
                ...payload,
                fromBeyond: true,
              });
            }}
          />
        </Suspense>
      </div>
    </MyDrawer>
  );
}

export default React.memo(MainDrawer);
