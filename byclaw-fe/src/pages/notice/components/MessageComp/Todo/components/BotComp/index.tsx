import React, { useMemo } from 'react';

import { Skeleton } from 'antd';
import { debounce, noop } from 'lodash';

import BeyondRender, { IProps as BeyondRenderProps } from '@/components/MessagesComp/MyBot/Renderer';

import styles from './index.module.less';

type IProps = Record<string, never> & BeyondRenderProps;

function BotComp(props: IProps) {
  const [canShow, setCanShow] = React.useState(false);

  const avatarCardItemRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!avatarCardItemRef.current || canShow) return noop;

    let observer: any;

    const callback = debounce((entries: IntersectionObserverEntry[]) => {
      entries.forEach((entry) => {
        if (entry.intersectionRatio > 0) {
          // 元素进入可视区域
          setCanShow(true);
          observer?.disconnect();
        } else {
          // 元素离开可视区域
        }
      });
    }, 300);

    observer = new IntersectionObserver(callback);
    observer.observe(avatarCardItemRef.current);
    return () => {
      observer.disconnect();
    };
  }, [canShow]);

  const Renderer = useMemo(() => {
    return BeyondRender;
  }, []);

  return (
    <div ref={avatarCardItemRef} className={styles.botComp}>
      {canShow && <Renderer {...props} />}
      {!canShow && <Skeleton className={styles.skeleton} />}
    </div>
  );
}

export default BotComp;
