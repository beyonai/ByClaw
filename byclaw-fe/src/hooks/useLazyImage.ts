import { useEffect, useRef, useState } from 'react';
import { noop } from 'lodash';

// 图片懒加载Hook
export function useLazyImage(src: string, options?: IntersectionObserverInit) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isInView, setIsInView] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return noop;

    const observer = new IntersectionObserver(([entry]) => {
      if (entry && entry.isIntersecting) {
        setIsInView(true);
        observer.disconnect();
      }
    }, options);

    observer.observe(img);

    return () => observer.disconnect();
  }, [options]);

  useEffect(() => {
    if (!isInView || !src) return;

    const img = new Image();
    img.onload = () => setIsLoaded(true);
    img.onerror = () => console.error('图片加载失败:', src);
    img.src = src;
  }, [isInView, src]);

  return { imgRef, isLoaded, isInView };
}

