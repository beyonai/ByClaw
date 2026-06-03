import React from 'react';
import { Button } from 'antd';
import { isPlainObject } from 'lodash';
import useAppStore from '@/models/common/useAppStore';
import useGlobal from '@/hooks/useGlobal';
import { getVNCUrl } from '@/utils/chat';

export default function VNC() {
  const { sandboxesInfo, setSiderCollapsed } = useAppStore();

  const { EventEmitter, sessionId } = useGlobal();

  const [visible, setVisible] = React.useState<boolean>(false);

  React.useEffect(() => {
    const handler = (data: { drawerType: string } | string) => {
      let myDrawerType = data;

      if (isPlainObject(data)) {
        myDrawerType = data?.drawerType;
      }

      if (myDrawerType === 'vnc') {
        setVisible(true);
      }
    };

    EventEmitter.on('beyond-main-driver-open-type', handler);
  }, []);

  React.useEffect(() => {
    setVisible(false);
  }, [sessionId]);

  if (!visible) return null;

  return (
    <Button
      ghost
      type="text"
      onClick={() => {
        const url = getVNCUrl(sandboxesInfo);
        setSiderCollapsed(true);
        EventEmitter.emit('beyond-main-driver-open-type', {
          drawerType: 'vnc',
          canClose: true,
          width: '50vw',
        });
        EventEmitter.emit('beyond-main-driver-message', {
          url,
        });
      }}
    >
      VNC
    </Button>
  );
}
