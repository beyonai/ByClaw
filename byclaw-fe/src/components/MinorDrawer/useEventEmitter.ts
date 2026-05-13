import { IGlobalContext } from '@/layout/components/provider/global';
import { getRandomNumber } from '@/utils/math';
import { isPlainObject, isString, noop } from 'lodash';
import React, { useCallback, useEffect, useState } from 'react';

type IMainMessage = {
  sessionId: string; // 会话id
  messageId: string; // 当前messageId
  agentId: string; // 主驾id
  // message?: IMessage// 消息内容
  // agentType: IAgentType //主驾类型

  templateId: string; // 模板id
  docId: string; // 文档id
};

export const INIT_DRAWER_CFG = {
  title: '',
  canFullScreen: false,
  canClose: false,
  canCloseContent: false,
  taskKey: '',
  width: '50vw',
  minWidth: '25vw',
  maxWidth: '70vw',
};

// 从pcLayout引用了useActionEffect，这个时候如果从useGlobal中获取EventEmitter，会报错
// 因此直接将EventEmitter作为参数传入

function useActionEffect(EventEmitter: IGlobalContext['EventEmitter']) {
  const [compKey, setCompKey] = useState<number>(getRandomNumber(0, 100));

  const [drawerCfg, setDrawerCfg] = useState({ ...INIT_DRAWER_CFG });
  const [drawerType, setDrawerType] = useState<string>('');
  const [contentPayload, setContentPayload] = useState<Record<string, any>>({});

  const [closeContent, setCloseContent] = useState(false);

  const driverOpen = useCallback((type: string) => {
    if (!isString(type)) {
      setDrawerType('');
      return;
    }

    const drawerType = `${type}`.toLocaleLowerCase();

    setDrawerType(['false', 'null', 'undefined'].includes(drawerType) ? '' : drawerType);
  }, []);

  const mySetCloseContent = React.useCallback((isClose: boolean) => {
    setCloseContent(isClose);
    if (isClose) {
      EventEmitter.emit('beyond-pclayout-close-content', true);
    } else {
      EventEmitter.emit('beyond-pclayout-close-content', false);
    }
  }, []);

  useEffect(() => {
    const onMessage = (data: Partial<IMainMessage> = {}) => {
      setContentPayload({ ...data });
    };

    EventEmitter.on('beyond-minor-driver-message', onMessage);
    return () => {
      EventEmitter.off('beyond-minor-driver-message', onMessage);
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

    EventEmitter.on('beyond-minor-driver-open-type', drawerTypeHandler);
    return () => {
      EventEmitter.off('beyond-minor-driver-open-type', drawerTypeHandler);
    };
  }, []);

  useEffect(() => {
    if (!drawerCfg.taskKey) return noop;
    const broadcastHander = (param: { taskKey: string; type: string }) => {
      if (param.taskKey !== drawerCfg.taskKey) return;
      const { type } = param;
      if (type === 'CLOSE') {
        EventEmitter.emit('beyond-minor-driver-open-type', '');
      }
      if (type === 'RESET') {
        setCompKey(getRandomNumber(0, 100));
      }
    };

    EventEmitter.on('beyond-broadcast-by-taskKey', broadcastHander);

    return () => {
      EventEmitter.on('beyond-broadcast-by-taskKey', broadcastHander);
    };
  }, [drawerCfg.taskKey]);

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
    setCompKey(getRandomNumber(0, 100));

    if (!drawerType) {
      setDrawerCfg({ ...INIT_DRAWER_CFG });
      mySetCloseContent(false);
    }
  }, [drawerType]);

  return {
    drawerCfg,
    drawerType,
    contentPayload,
    closeContent,
    setDrawerCfg,
    setDrawerType,
    setContentPayload,
    setCloseContent: mySetCloseContent,

    driverOpen,
    compKey,
  };
}

export default useActionEffect;
