import useGlobal from '@/hooks/useGlobal';
import { isPlainObject, isString } from 'lodash';
import { useCallback, useEffect, useState } from 'react';

type IMainMessage = {
  sessionId: string; // 会话id
  messageId: string; // 当前messageId
  agentId: string; // 主驾id
  // message?: IMessage// 消息内容
  // agentType: IAgentType //主驾类型

  templateId: string; // 模板id
  docId: string; // 文档id
};

const INIT_DRAWER_CFG = {
  title: '',
  canFullScreen: false,
  canClose: true,
};

function useActionEffect() {
  const [drawerCfg, setDrawerCfg] = useState({ ...INIT_DRAWER_CFG });
  const [drawerType, setDrawerType] = useState<string>('');
  const [contentPayload, setContentPayload] = useState<Record<string, any>>({});
  const { EventEmitter } = useGlobal();

  const driverOpen = useCallback((type: string) => {
    if (!isString(type)) {
      setDrawerType('');
      return;
    }

    const drawerType = `${type}`.toLocaleLowerCase();

    setDrawerType(['false', 'null', 'undefined'].includes(drawerType) ? '' : drawerType);
  }, []);

  useEffect(() => {
    const onMessage = (data: Partial<IMainMessage> = {}) => {
      setContentPayload({ ...data });
    };

    EventEmitter.on('beyond-fullabsolute-driver-message', onMessage);
    return () => {
      EventEmitter.off('beyond-fullabsolute-driver-message', onMessage);
    };
  }, []);

  useEffect(() => {
    const drawerTypeHandler = (data: any) => {
      let myDrawerType = data;

      if (isPlainObject(data)) {
        const { drawerType, ...rest } = data;
        setDrawerCfg(Object.assign(INIT_DRAWER_CFG, { ...rest }));
        myDrawerType = drawerType;
      }

      setDrawerType(myDrawerType);
    };

    EventEmitter.on('beyond-fullabsolute-driver-open-type', drawerTypeHandler);
    return () => {
      EventEmitter.off('beyond-fullabsolute-driver-open-type', drawerTypeHandler);
    };
  }, []);

  useEffect(() => {
    const drawerTypeHandler = () => {
      setDrawerType('');
    };

    EventEmitter.on('beyond-driver-close', drawerTypeHandler);
    return () => {
      EventEmitter.off('beyond-driver-close', drawerTypeHandler);
    };
  }, []);

  useEffect(() => {
    if (!drawerType) {
      setDrawerCfg({ ...INIT_DRAWER_CFG });
    }
  }, [drawerType]);

  return {
    drawerCfg,
    drawerType,
    contentPayload,
    setDrawerCfg,
    setDrawerType,
    setContentPayload,

    driverOpen,
  };
}

export default useActionEffect;
