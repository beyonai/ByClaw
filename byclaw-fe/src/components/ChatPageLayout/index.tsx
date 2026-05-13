import React from 'react';
import classNames from 'classnames';
import styles from './index.module.less';

interface Props {
  id?: string;
  scrollId?: string;
  isBottom: boolean;
  className?: string;
  title?: React.ReactNode;
  bottom?: React.ReactNode;
  main: React.ReactNode;
  children?: React.ReactNode;
}

export default function ChatPageLayout(props: Props) {
  const { isBottom, title, bottom, main, children } = props;

  return (
    <div className={classNames(styles.chatLayout)} id={props.id}>
      <div
        id={props.scrollId}
        data-isbottom={isBottom}
        className={classNames(styles.wrap, props.className, 'minW550 hideThumb')}
        style={{
          ...(isBottom ? { flex: '1 0 0', overflow: 'hidden' } : {}),
          ...(!isBottom ? { overflow: 'auto' } : {}),
        }}
      >
        {!isBottom && title}
        <div className={classNames({ [styles.fixed]: !isBottom, 'ub-f1': isBottom })}>{main}</div>
        {!isBottom && <React.Suspense fallback={null}>{bottom}</React.Suspense>}
        {children}
      </div>
    </div>
  );
}
