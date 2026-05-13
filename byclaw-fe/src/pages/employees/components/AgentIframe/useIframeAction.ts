import React from 'react';
import { useDispatch } from '@umijs/max';
import {} from 'lodash';

import useAppStore from '@/models/common/useAppStore';

type IProps = {
  uuidRef: React.RefObject<string>;

  onClose: () => void;
  onLoadedCb: () => void;
};

function useIframeAction(props: IProps) {
  const { uuidRef } = props;
  const { onLoadedCb, onClose } = props;

  const { setSiderCollapsed } = useAppStore();

  const dispatch = useDispatch();

  React.useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const { eventType, data, type } = event.data;
      console.log(event);
      const myEventType = eventType || type;

      if (event.data.uuid && event.data.uuid !== uuidRef.current) return;

      if (myEventType === 'onload') {
        onLoadedCb();
      }
      if (myEventType === 'siderIsCollapsed') {
        const { content } = data;
        setSiderCollapsed(!!content);
      }
      if (myEventType === 'createSession') {
        dispatch({
          type: 'session/addSession',
          payload: {
            ...(data || {}),
          },
        });
      }
      if (myEventType === 'close') {
        onClose();
      }
    };

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [onClose, onLoadedCb]);

  return {};
}

export default useIframeAction;
