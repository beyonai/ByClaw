// tslint:disable:ordered-imports
import React, { Suspense, useRef } from 'react';
import { Drawer } from 'antd';
import useGlobal from '@/hooks/useGlobal';
import IframeRender from '@/components/MessagesComp/Iframe/IframeRender';
import useActionEffect from './useEventEmitter';
import { getRandomNumber } from '@/utils/math';
import { IMessage } from '@/typescript/message';
import WriterMaterialIframe from '@/components/wisdomPen/MaterialIframe';

import styles from './index.module.less';

const FragmentComp = () => null;

type IProps = {
  getContainer?: () => HTMLElement | null;
};

type IDrawerMessage = Partial<IMessage> & {
  messageId: string;
};

function AbsoluteDrawer(props: IProps) {
  const { getContainer } = props;
  const { EventEmitter } = useGlobal();

  const keyRef = useRef(getRandomNumber(0, 100));

  const {
    drawerCfg,
    drawerType,
    contentPayload,

    driverOpen,
  } = useActionEffect();

  const ContentComp = React.useMemo(() => {
    if (drawerType === 'writerMateriaIframe') {
      return WriterMaterialIframe;
    }
    if (drawerType === 'iframe') {
      return IframeRender;
    }

    return FragmentComp;
  }, [drawerType]);

  return (
    <Drawer
      getContainer={() => getContainer?.() || document.body}
      destroyOnHidden
      open={!!drawerType}
      width="100%"
      placement="right"
      footer={null}
      mask={false}
      title={drawerCfg.title}
      styles={{
        body: {
          padding: '0',
        },
        header: {
          padding: '12px',
        },
      }}
      rootClassName={styles.drawer}
      onClose={() => {
        driverOpen('');
      }}
      rootStyle={{
        position: 'relative',
        backgroundColor: '#fff',
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

export default AbsoluteDrawer;
