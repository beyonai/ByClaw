import React, { useRef, useState, useEffect } from 'react';
import { debounce } from 'lodash';
import styles from './index.less';

function Size(props: any) {
  const wrapRef = useRef(null);
  const [state, setState] = useState({ width: 0, height: 0 });
  const [loading, setLoading] = useState(false);
  const { children, style = {}, onResize: propsOnResize, onRootRef, getRootRef, key, ...otherProps } = props;

  let timeout: number | null = null;

  // resize事件，重新计算width，height
  const onResize = () => {
    // 如未获取到current,组件已被销毁
    if (!wrapRef.current) {
      return;
    }

    setLoading(true);

    if (timeout) {
      window.clearTimeout(timeout);
    }

    timeout = window.setTimeout(() => {
      // 如未获取到current,组件已被销毁
      if (!wrapRef.current) {
        return;
      }
      const { clientWidth: width, clientHeight: height } = wrapRef.current;
      setState({ width, height });
      // // 绑定传递的函数
      if (propsOnResize) {
        propsOnResize(width, height);
      }
      setLoading(false);
    }, 100);
  };

  useEffect(() => {
    const rootRefHandler = onRootRef || getRootRef;
    if (rootRefHandler) {
      rootRefHandler(wrapRef);
    }
  }, [getRootRef, onRootRef]);

  useEffect(() => {
    // 加载完成后调用
    onResize();

    const debounceOnResize = debounce(onResize, 100);

    // 绑定窗口变化事件,利用loading变化，重新加载
    window.addEventListener('resize', debounceOnResize);
    // 取消绑定事件
    return () => {
      window.removeEventListener('resize', debounceOnResize);
      if (timeout) {
        window.clearTimeout(timeout);
      }
    };
  }, []);

  const { width, height } = state;

  return (
    <div
      key={key}
      ref={wrapRef}
      className={styles.layoutSize}
      style={{ width: '100%', height: '100%', ...style }}
      {...otherProps}
    >
      {!loading && children(width, height)}
    </div>
  );
}

export default Size;
