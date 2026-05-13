import React, { Suspense, useMemo } from 'react';
import useGlobal from '@/hooks/useGlobal';
import useActionEffect from './useEventEmitter';
import WriterEditorIframe from '@/components/wisdomPen/EditorIframe';
import WriterPPTIframe from '@/components/wisdomPen/PPTIframe';
import IframeRender from '@/components/MessagesComp/Iframe/IframeRender';
import MyDrawer from './myDrawer';

import { IMessage } from '@/typescript/message';

type IDrawerMessage = Partial<IMessage> & {
  messageId: string;
};

const FragmentComp = () => null;

function MinorDrawer() {
  const { EventEmitter } = useGlobal();
  const { drawerCfg, drawerType, contentPayload, compKey, ...resetActionEffect } = useActionEffect(EventEmitter);

  const ContentComp = useMemo(() => {
    if (drawerType === 'writerPPTIframe') {
      return WriterPPTIframe;
    }
    if (drawerType === 'writerEditorIframe') {
      return WriterEditorIframe;
    }
    if (drawerType === 'iframe') {
      return IframeRender;
    }

    return FragmentComp;
  }, [drawerType]);

  return (
    <MyDrawer
      open={!!drawerType}
      drawerCfg={drawerCfg}
      onClose={() => {
        EventEmitter.emit('beyond-minor-driver-open-type', '');
      }}
      onFullScreen={() => {
        EventEmitter.emit('beyond-fullscreen-modal-message', {
          ...(contentPayload || {}),
        });
        EventEmitter.emit('beyond-fullscreen-modal-open-type', drawerType);
        EventEmitter.emit('beyond-minor-driver-open-type', '');
      }}
      {...resetActionEffect}
    >
      <div className="full-width full-height overflow-hidden">
        <Suspense fallback="loading...">
          <ContentComp
            key={compKey}
            {...(contentPayload || {})}
            onClose={() => {
              EventEmitter.emit('beyond-minor-driver-open-type', '');
            }}
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
            onDelMessage={(payload: Omit<IDrawerMessage, 'messageId'>) => {
              console.log('onDelMessage', payload);
              EventEmitter.emit('beyond-delete-message', {
                ...payload,
              });
            }}
          />
        </Suspense>
      </div>
    </MyDrawer>
  );
}

export default MinorDrawer;
