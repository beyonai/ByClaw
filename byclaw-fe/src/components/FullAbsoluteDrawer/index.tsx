// tslint:disable:ordered-imports
import React, { Suspense, useRef } from 'react';
import { Drawer } from 'antd';
import useGlobal from '@/hooks/useGlobal';
import IframeRender from '@/components/MessagesComp/Iframe/IframeRender';
import useActionEffect from './useEventEmitter';
import { getRandomNumber } from '@/utils/math';
import { IMessage } from '@/typescript/message';

import styles from './index.module.less';

const FragmentComp = () => null;

const ApplicationSession = React.lazy(() => import('@/components/ApplicationSession'));
const ReplayTemplate = React.lazy(() => import('@/components/ReplayTemplate'));

type IProps = {
  getContainer?: () => HTMLElement | null;
};

export type IDrawerMessage = Partial<IMessage> & {
  messageId: string;
};

function FullAbsoluteDrawer(props: IProps) {
  const { getContainer } = props;
  const { EventEmitter } = useGlobal();

  const keyRef = useRef(getRandomNumber(0, 100));

  const {
    drawerCfg,
    drawerType,
    contentPayload,

    driverOpen,
  } = useActionEffect();

  const { canClose, title } = drawerCfg;

  const ContentComp = React.useMemo(() => {
    if (drawerType === 'application') {
      return ApplicationSession;
    }
    if (drawerType === 'iframe') {
      return IframeRender;
    }
    if (drawerType === 'replaytmplate') {
      return ReplayTemplate;
    }

    return FragmentComp;
  }, [drawerType]);

  return (
    <Drawer
      getContainer={() => getContainer?.() || document.body}
      destroyOnHidden
      open={!!drawerType}
      width="96%"
      placement="right"
      footer={null}
      mask
      maskClosable={canClose}
      title={title}
      styles={{
        body: {
          padding: '0',
        },
        header: {
          display: canClose ? 'block' : 'none',
          padding: '12px',
        },
      }}
      rootClassName={styles.drawer}
      onClose={() => {
        driverOpen('');
      }}
      rootStyle={{
        // position: 'relative',
        // backgroundColor: '#fff',
        width: '100%',
      }}
    >
      <div className="full-width full-height overflow-hidden">
        <Suspense fallback="loading...">
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
    </Drawer>
  );
}

export default FullAbsoluteDrawer;
