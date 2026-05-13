import useGlobal from '@/hooks/useGlobal';
import { isString, isPlainObject } from 'lodash';
import { useCallback, useEffect, useState } from 'react';

export type IModalMessage = {
  sessionId: string; // 会话id
  messageId: string; // 当前messageId
  agentId: string; // 主驾id
  // message?: IMessage// 消息内容
  // agentType: IAgentType //主驾类型

  templateId: string; // 模板id
  docId: string; // 文档id

  url: string;
  needToken?: string;
};

const INIT_DRAWER_CFG = {
  canClose: true,
  width: '96%',
  height: '96%',
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
    const onMessage = (data: Partial<IModalMessage> = {}) => {
      setContentPayload({ ...data });
    };

    EventEmitter.on('beyond-fullscreen-modal-message', onMessage);
    return () => {
      EventEmitter.off('beyond-fullscreen-modal-message', onMessage);
    };
  }, []);

  useEffect(() => {
    const drawerTypeHandler = (data: any) => {
      let myDrawerType = data;

      if (isPlainObject(data)) {
        const { drawerType, ...rest } = data;
        setDrawerCfg(Object.assign({}, INIT_DRAWER_CFG, { ...rest }));
        myDrawerType = drawerType;
      }

      setDrawerType(myDrawerType);
    };

    EventEmitter.on('beyond-fullscreen-modal-open-type', drawerTypeHandler);
    return () => {
      EventEmitter.off('beyond-fullscreen-modal-open-type', drawerTypeHandler);
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
