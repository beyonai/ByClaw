import React from 'react';
import { message } from 'antd';
// @ts-ignore
import { getIntl } from '@umijs/max';

type IProps = {
  uuid: string;
  onClose: () => void;
};

function useIframeAction(props: IProps) {
  const { uuid, onClose } = props;

  React.useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const { type, data, eventType } = event.data;
      console.log(event);
      const myEventType = eventType || type;
      if (event.data.uuid !== uuid) return;

      if (myEventType === 'saveSuccess') {
        const intl = getIntl();
        message.success(intl.formatMessage({ id: 'common.saveSuccess' }));
        onClose();
      }
      if (myEventType === 'saveError') {
        const intl = getIntl();
        message.error(intl.formatMessage({ id: 'common.saveFailed' }));
        console.error(data);
      }
      if (myEventType === 'close') {
        onClose();
      }
    };

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [onClose, uuid]);
}

export default useIframeAction;
