import { useEffect, useRef } from 'react';

// 项目详情各 Tab 共用底部哨兵，滚动容器接近底部时触发下一页加载。
export const useInfiniteScroll = (onLoadMore: () => void, enabled: boolean) => {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef(onLoadMore);
  const triggeredRef = useRef(false);

  useEffect(() => {
    loadMoreRef.current = onLoadMore;
  }, [onLoadMore]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !enabled || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        const intersecting = entries.some((entry) => entry.isIntersecting);
        // 哨兵持续可见时只请求一次；离开后再次进入才允许加载下一页，避免状态更新导致观察器循环触发。
        if (intersecting && !triggeredRef.current) {
          triggeredRef.current = true;
          loadMoreRef.current();
        } else if (!intersecting) {
          triggeredRef.current = false;
        }
      },
      { rootMargin: '160px 0px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [enabled]);

  return sentinelRef;
};
