import React from 'react';
import { Button } from 'antd';
import { useIntl } from '@umijs/max';
import { isPlainObject } from 'lodash';
import DesktopOutlined from '@ant-design/icons/DesktopOutlined';
import useAppStore from '@/models/common/useAppStore';
import useGlobal from '@/hooks/useGlobal';
import { getVNCUrl, resolveSandboxesInfo } from '@/utils/chat';

export default function VNC() {
  const intl = useIntl();
  const { sandboxesInfo, setSiderCollapsed } = useAppStore();

  const { EventEmitter, sessionId } = useGlobal();

  const [visible, setVisible] = React.useState<boolean>(false);

  React.useEffect(() => {
    const handler = (data: { drawerType: string } | string) => {
      let myDrawerType = data;

      if (isPlainObject(data)) {
        myDrawerType = (data as { drawerType?: string })?.drawerType;
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
      onClick={async () => {
        const resolvedSandboxesInfo = await resolveSandboxesInfo(sandboxesInfo);
        if (!resolvedSandboxesInfo?.sandboxId) return;

        const url = getVNCUrl(resolvedSandboxesInfo);
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
      title={intl.formatMessage({ id: 'common.remoteComputer' })}
    >
      <DesktopOutlined />
    </Button>
  );
}
