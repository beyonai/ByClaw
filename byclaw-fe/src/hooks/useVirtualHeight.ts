import { useCallback, useEffect, useRef, useState } from 'react';

export default function useVirtualHeight(container: React.RefObject<HTMLElement | null>) {
  const [height, setHeight] = useState(0);
  const resizeObserver = useRef<ResizeObserver | null>(null);

  const calcHeight = useCallback(() => {
    if (container.current) {
      if (container.current) {
        setHeight(container.current.clientHeight);
      }
    }
  }, []);

  useEffect(() => {
    calcHeight();
    if (container.current && window.ResizeObserver) {
      // 通过ResizeObserver 监听高度变化
      resizeObserver.current = new ResizeObserver(calcHeight);
      resizeObserver.current.observe(container.current);
    }
    return () => {
      if (resizeObserver.current) {
        resizeObserver.current.disconnect();
      }
    };
  }, []);

  return height;
}
