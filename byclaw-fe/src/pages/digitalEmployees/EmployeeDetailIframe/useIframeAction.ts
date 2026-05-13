import React from 'react';

type IProps = {
  uuid: string;
  onClose: () => void;
  onSaveSuccess: () => void;
};

function useIframeAction(props: IProps) {
  const { uuid, onClose, onSaveSuccess } = props;

  React.useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;

      const payload = event.data || {};
      const { type, data, eventType, uuid: msgUuid } = payload;
      const myEventType = eventType || type;

      if (!myEventType) return;
      if (msgUuid !== uuid) return;

      if (myEventType === 'close') {
        onClose();
        return;
      }

      if (myEventType === 'saveSuccess') {
        onSaveSuccess();
      }

      if (myEventType === 'saveError') {
        console.error(data);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [onClose, onSaveSuccess, uuid]);
}

export default useIframeAction;
