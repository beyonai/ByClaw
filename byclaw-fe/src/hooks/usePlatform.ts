import { IGridType, IPlatform } from '@/typescript/platform';
import { debounce } from 'lodash';
import { useEffect, useState } from 'react';

function getBodyW() {
  return Math.floor(window.document.body.clientWidth);
}

export function platformhandler(w: number = getBodyW()) {
  const ua = window.navigator.userAgent;

  const isWindowsPhone = /(?:Windows Phone)/.test(ua);
  const isSymbian = /(?:SymbianOS)/.test(ua) || isWindowsPhone;
  const isAndroid = /(?:Android)/.test(ua);
  const isFireFox = /(?:Firefox)/.test(ua);
  const isTablet =
    /(?:iPad|PlayBook)/.test(ua) || (isAndroid && !/(?:Mobile)/.test(ua)) || (isFireFox && /(?:Tablet)/.test(ua));
  const isPhone = /(?:iPhone)/.test(ua) && !isTablet;
  const isPc = !isPhone && !isAndroid && !isSymbian;

  const os = {
    isTablet,
    isPhone,
    isAndroid,
    isPc,
  };

  // 手机
  if (os.isAndroid || os.isPhone || w <= IGridType.xs) {
    return IPlatform.phone;
  }
  // 平板
  if (os.isTablet) {
    return IPlatform.phone;
  }
  // 电脑
  if (os.isPc) {
    return IPlatform.pc;
  }

  return IPlatform.pc;
}

function usePlatform() {
  const [platform, setPlatform] = useState<IPlatform>(() => platformhandler(getBodyW()));
  const [bodyW, setBodyW] = useState<number>(getBodyW());

  useEffect(() => {
    const platform = platformhandler(bodyW);

    setPlatform(platform);
  }, [bodyW]);

  useEffect(() => {
    const onresize = debounce(() => {
      setBodyW(getBodyW());
    }, 300);

    window.addEventListener('resize', onresize);

    return () => {
      window.removeEventListener('resize', onresize);
    };
  }, []);

  return [platform];
}

export default usePlatform;
