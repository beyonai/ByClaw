import React, { useEffect, useCallback, createContext } from 'react';
import { isString } from 'lodash';
import { Spin } from 'antd';
import { useDispatch, useSelector, Outlet } from '@umijs/max';
import { setUserToken } from '@/utils/auth';

export const AppBridgeContext = createContext<{
  myPostmessage: (message: string | Record<string, unknown>) => void;
  onMessageListener: (fn: (event: MessageEvent) => void) => () => void;
    }>({
      myPostmessage: () => {},
      onMessageListener: () => () => {},
    });

export default function AppBridge() {
  const dispatch = useDispatch();

  const { userInfo } = useSelector(({ user }) => ({ userInfo: user.userInfo }));

  const onMessageListener = React.useCallback((fn: (event: MessageEvent) => void) => {
    document?.addEventListener?.('message', fn);
    window?.addEventListener?.('message', fn);

    return () => {
      document?.addEventListener?.('message', fn);
      window?.removeEventListener?.('message', fn);
    };
  }, []);

  const myPostmessage = React.useCallback((message: string | Record<string, unknown>) => {
    let payload = message;

    try {
      if (!isString(payload)) {
        payload = JSON.stringify(payload);
      }
    } catch (error) {
      console.error(error);
    }

    if (window?.ReactNativeWebView?.postMessage) {
      window?.ReactNativeWebView?.postMessage(payload);
    }

    if (window?.parent?.postMessage) {
      window.parent.postMessage(payload, '*');
    }
  }, []);

  const initUserInfo = useCallback(() => {
    dispatch({
      type: 'user/initUserInfo',
      payload: {},
    });
  }, [dispatch]);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      let payload = event.data;

      try {
        if (isString(payload)) {
          payload = JSON.parse(payload);
        }
      } catch (error) {
        console.error(error);
      }

      const { type, data } = payload;
      if (type === 'app-set-userInfo') {
        setUserToken(data);
        initUserInfo();
      }
    };

    const cancelFn = onMessageListener(handler);
    return cancelFn;
  }, []);

  useEffect(() => {
    if (!userInfo) return;

    myPostmessage('beyond-iframe-ready');
  }, [userInfo]);

  if (!userInfo) {
    return <Spin spinning style={{ height: '100vh', width: '100vw', display: 'flex' }} className="ub-ac ub-pc" />;
  }

  return (
    <AppBridgeContext.Provider value={{ myPostmessage, onMessageListener }}>
      <Outlet />
    </AppBridgeContext.Provider>
  );
}
