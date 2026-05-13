import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Spin } from 'antd';

import styles from './index.module.less';

type IProps = {
  url: string;
  iframePayload?: Record<string, any>;
  onMessage?: (data: { type: string; data: any }) => void;
  onLoad?: (iframeRef: React.RefObject<HTMLIFrameElement | null>) => void;
};

const emptyObj = {};

function IframeRender(props: IProps) {
  const { url, iframePayload = emptyObj, onMessage, onLoad } = props;
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [iframeSrc, setIframeSrc] = useState(url);
  const [isLoading, setIsLoading] = useState(true);

  // 记录上次发送的payload，避免重复发送
  const lastPayloadRef = useRef<any>(emptyObj);

  // 发送postMessage到iframe
  const postPayloadToIframe = useCallback(() => {
    if (!iframeRef.current) return;
    try {
      const payload = iframePayload || {};
      // 只在payload变化时发送
      if (!payload || JSON.stringify(lastPayloadRef.current) === JSON.stringify(payload)) {
        return;
      }

      lastPayloadRef.current = payload;

      iframeRef.current.contentWindow?.postMessage(
        {
          type: 'beyond-iframe-payload',
          data: payload,
        },
        '*'
      );
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('postMessage to iframe error', e);
    }
  }, [iframePayload]);

  // iframe 加载完成后发送payload
  const handleIframeLoad = useCallback(() => {
    setIsLoading(false);
    postPayloadToIframe();
    onLoad?.(iframeRef);
  }, [postPayloadToIframe, onLoad]);

  // 监听payload变化，iframe已加载时也发送
  useEffect(() => {
    postPayloadToIframe();
  }, [postPayloadToIframe]);

  useEffect(() => {
    setIframeSrc(url);
  }, [url]);

  useEffect(() => {
    // 监听来自iframe的postMessage事件
    const handleMessage = (event: MessageEvent) => {
      const { data } = event;
      console.log('handleMessage', event);
      // 可根据需要校验event.origin或event.source
      if (data.type === 'beyond-iframe-receive-payload') {
        if (typeof onMessage === 'function') {
          onMessage(data.data);
        }
      }
      if (data.type === 'iframe-set-height' && iframeRef.current) {
        const heightValue = typeof data.data === 'number' ? `${data.data}px` : String(data.data ?? '');

        iframeRef.current.style.height = heightValue;
      }
    };
    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [onMessage]);

  useEffect(() => {
    const onLoaded = () => {
      handleIframeLoad();
    };
    iframeRef.current?.addEventListener('load', onLoaded, { once: true });
    return () => {
      iframeRef.current?.removeEventListener('load', onLoaded);
    };
  }, []);

  return (
    <div className="full-width full-height">
      <Spin spinning={isLoading} className={styles.spin} wrapperClassName={styles.spinWrapper}>
        <iframe
          ref={iframeRef}
          width="100%"
          height="100%"
          frameBorder="0"
          src={iframeSrc}
          style={{
            border: 'none',
            overflow: 'hidden',
            backgroundColor: '#fff',
          }}
          onLoad={handleIframeLoad}
          title="beyond"
          allow="camera;microphone;clipboard-read;clipboard-write;self"
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-downloads allow-popups-to-escape-sandbox"
        />
      </Spin>
    </div>
  );
}

export default IframeRender;

// sandbox：
// allow-same-origin: 允许iframe内容被视为与父页面同源
// allow-scripts: 允许执行JavaScript
// allow-popups: 允许弹出窗口
// allow-forms: 允许提交表单
// allow-modals: 允许显示模态框
// allow-orientation-lock: 允许锁定屏幕方向
// allow-pointer-lock: 允许锁定鼠标指针
// allow-presentation: 允许全屏显示
// allow-top-navigation: 允许iframe导航顶层页面
// allow-top-navigation-by-user-activation: 允许用户激活时导航顶层页面
// allow-downloads: 允许下载文件
// allow-storage-access-by-user-activation: 允许用户激活时访问存储

// allow：
// accelerometer: 允许访问加速度计
// autoplay: 允许自动播放
// camera: 允许访问摄像头
// clipboard-read: 允许读取剪贴板
// clipboard-write: 允许写入剪贴板
// encrypted-media: 允许使用加密媒体
// fullscreen: 允许进入全屏模式
// geolocation: 允许访问地理位置
// gyroscope: 允许访问陀螺仪
// microphone: 允许访问麦克风
// midi: 允许访问MIDI设备
// payment: 允许调用支付请求API
// picture-in-picture: 允许画中画模式
// speaker: 允许访问扬声器
// usb: 允许访问USB设备
// xr-spatial-tracking: 允许访问XR空间追踪
