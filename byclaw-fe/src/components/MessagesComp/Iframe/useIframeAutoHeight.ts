import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';

export default function useIframeAutoHeight(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  enabled: boolean,
  src: string
) {
  const pauseRef = useRef<(() => void) | undefined>(undefined);
  const pauseAutoHeight = useCallback(() => pauseRef.current?.(), []);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!enabled || !iframe) return undefined;

    const originalHeight = iframe.style.height;
    let cleanupDocument: (() => void) | undefined;
    let hasExplicitHeight = false;
    let explicitlySizedDocument: Document | null | undefined;
    const stopObservingDocument = () => {
      cleanupDocument?.();
      cleanupDocument = undefined;
    };
    pauseRef.current = () => {
      stopObservingDocument();
      hasExplicitHeight = true;
      try {
        explicitlySizedDocument = iframe.contentDocument;
      } catch {
        explicitlySizedDocument = undefined;
      }
    };

    const observeDocument = () => {
      stopObservingDocument();

      let previewDocument: Document | null;
      try {
        previewDocument = iframe.contentDocument;
      } catch {
        // 外部页面可能跨域，继续使用原有高度和消息协议。
        return;
      }
      // 脚本可能在 load 前发送高度；同一文档加载完成后仍保持显式高度。
      if (hasExplicitHeight && previewDocument === explicitlySizedDocument) return;
      hasExplicitHeight = false;
      iframe.style.height = originalHeight;
      if (!previewDocument?.body) return;

      const { body, documentElement, fonts } = previewDocument;
      let disposed = false;
      let frame: number | undefined;
      let width = iframe.getBoundingClientRect().width;

      const measureHeight = () => {
        if (disposed || !iframe.getBoundingClientRect().width) return;

        const previousHeight = iframe.style.height;
        try {
          if (iframe.contentDocument !== previewDocument) return;
          // 消除 100vh / 100% 对旧视口的依赖，内容缩小时也能重新测得自然高度。
          iframe.style.height = '0px';
          const height = Math.ceil(
            Math.max(body.scrollHeight, body.offsetHeight, documentElement.scrollHeight, documentElement.offsetHeight)
          );
          iframe.style.height = height > 0 ? `${height}px` : previousHeight;
        } catch {
          iframe.style.height = previousHeight;
        }
      };

      const scheduleMeasure = () => {
        if (disposed || frame !== undefined) return;
        frame = requestAnimationFrame(() => {
          frame = undefined;
          measureHeight();
        });
      };

      const handleResize: ResizeObserverCallback = (entries) => {
        const changed = entries.some((entry) => {
          if (entry.target !== iframe) return true;
          if (entry.contentRect.width === width) return false;
          width = entry.contentRect.width;
          return true;
        });
        if (changed) scheduleMeasure();
      };
      const resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(handleResize);
      resizeObserver?.observe(body);
      resizeObserver?.observe(documentElement);
      resizeObserver?.observe(iframe);

      // 100vh 会掩盖内容缩小引起的盒尺寸变化，DOM 变化也需要触发测量。
      const mutationObserver = new MutationObserver(scheduleMeasure);
      mutationObserver.observe(documentElement, {
        attributes: true,
        childList: true,
        characterData: true,
        subtree: true,
      });
      previewDocument.addEventListener('load', scheduleMeasure, true);
      fonts?.addEventListener('loadingdone', scheduleMeasure);
      void fonts?.ready.then(scheduleMeasure);
      if (!resizeObserver) window.addEventListener('resize', scheduleMeasure);

      cleanupDocument = () => {
        disposed = true;
        if (frame !== undefined) cancelAnimationFrame(frame);
        resizeObserver?.disconnect();
        mutationObserver.disconnect();
        previewDocument?.removeEventListener('load', scheduleMeasure, true);
        fonts?.removeEventListener('loadingdone', scheduleMeasure);
        if (!resizeObserver) window.removeEventListener('resize', scheduleMeasure);
      };
      scheduleMeasure();
    };

    iframe.addEventListener('load', observeDocument);
    observeDocument();

    return () => {
      iframe.removeEventListener('load', observeDocument);
      stopObservingDocument();
      pauseRef.current = undefined;
      iframe.style.height = originalHeight;
    };
  }, [enabled, iframeRef, src]);

  return pauseAutoHeight;
}
