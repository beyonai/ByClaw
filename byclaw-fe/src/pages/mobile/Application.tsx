import React, { useContext } from 'react';
import { isString, isEmpty } from 'lodash';
import { AppBridgeContext } from '@/layout/mobileLayout/AppBridge';
import ApplicationSession from '@/components/ApplicationSession';

import { EventEmitter$Cls } from '@/utils/eventEmitter';
import GlobalContext, { Platform } from '@/layout/components/provider/global';

import { ISendConf, ISendProps } from '@/hooks/useChat';
import { IMessage } from '@/typescript/message';

const myEventEmitter = new EventEmitter$Cls();

function Application() {
  const { myPostmessage, onMessageListener } = useContext(AppBridgeContext);
  const [applicationProps, setApplicationProps] = React.useState<any>(null);

  React.useEffect(() => {
    myPostmessage(JSON.stringify({ type: 'beyond-application-get-props' }));

    const onMessage = (event: MessageEvent) => {
      let payload = event.data;

      try {
        if (isString(payload)) {
          payload = JSON.parse(payload);
        }
      } catch (error) {
        console.error(error);
      }

      const { type, data } = payload;
      if (type === 'app-application-set-props') {
        setApplicationProps({ ...(data || {}) });
      }
    };

    const cancelFn = onMessageListener(onMessage);
    return cancelFn;
  }, []);

  React.useEffect(() => {
    const onSendMsg = (param: { sendProps: ISendProps; sendConf?: ISendConf }) => {
      console.log('onSendMsg', param);
      myPostmessage({ type: 'beyond-chat-on-send-msg', data: param });
    };
    myEventEmitter.on('beyond-chat-on-send-msg', onSendMsg);

    return () => {
      myEventEmitter.off('beyond-chat-on-send-msg', onSendMsg);
    };
  }, [myPostmessage]);

  if (!applicationProps || isEmpty(applicationProps)) return null;

  return (
    <div className="full-width full-height">
      <GlobalContext.Provider
        value={{
          platform: Platform.mobile,
          sessionId: '',
          agentId: '',
          EventEmitter: myEventEmitter,
        }}
      >
        <ApplicationSession
          {...applicationProps}
          onClose={() => {
            myPostmessage(JSON.stringify({ type: 'beyond-application-close' }));
          }}
          onUpdateMessage={(newMessage: IMessage) => {
            if (!newMessage.messageId) return;
            myPostmessage({
              type: 'beyond-update-message',
              data: {
                message: newMessage,
                opt: {},
              },
            });
          }}
        />
      </GlobalContext.Provider>
    </div>
  );
}

export default Application;
