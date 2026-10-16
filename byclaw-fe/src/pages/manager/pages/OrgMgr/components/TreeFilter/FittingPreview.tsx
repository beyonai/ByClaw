import React, { useLayoutEffect, useRef, useState } from 'react';
import type { ITreeData } from './index';
import styles from './index.module.less';

type Props = {
  items: ITreeData[];
  maxWidth: number;
  itemMaxWidth: number;
  onSelect: (item: ITreeData) => void;
};

export default function FittingPreview({ items, maxWidth, itemMaxWidth, onSelect }: Props) {
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(items.length);

  useLayoutEffect(() => {
    const measure = measureRef.current;
    if (!measure) return;

    const update = () => {
      const gap = Number.parseFloat(getComputedStyle(measure).columnGap) || 0;
      let usedWidth = 0;
      let count = 0;
      for (const item of Array.from(measure.children)) {
        const width = item.getBoundingClientRect().width;
        const nextWidth = usedWidth + (count ? gap : 0) + width;
        // 只展示能完整容纳的连续前缀，不能用省略号保留半个选项。
        if (width > itemMaxWidth || nextWidth > maxWidth) break;
        usedWidth = nextWidth;
        count += 1;
      }
      setVisibleCount(count);
    };

    update();
    // 独立测量完整内容，隐藏第三项后仍可在字典、语言或字体变化时重新显示。
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
    observer?.observe(measure);
    Array.from(measure.children).forEach((item) => observer?.observe(item));
    return () => observer?.disconnect();
  }, [items, itemMaxWidth, maxWidth]);

  return (
    <div className={styles.fittingPreview}>
      <div className={styles.previewMeasure} aria-hidden="true">
        <div className={styles.previewItems} ref={measureRef}>
          {items.map((item) => (
            <span key={item.key} className={styles.item}>
              {item.label}
            </span>
          ))}
        </div>
      </div>
      <div className={styles.previewItems}>
        {items.slice(0, visibleCount).map((item) => (
          <span key={item.key} className={styles.item} onClick={() => onSelect(item)}>
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}
