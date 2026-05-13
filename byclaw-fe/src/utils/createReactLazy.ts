import React, { useLayoutEffect } from 'react';

export default function createReactLazy(onLoaded: () => void) {
  function lazy<T extends React.ComponentType<any>>(
    importFn: () => Promise<{ default: T }>
  ): React.LazyExoticComponent<any> {
    // 存储加载状态和结果
    let status: 'pending' | 'success' | 'error' = 'pending';
    let result: any = null;
    let promise: null | Promise<void> = null;

    // 启动加载函数
    const load = () => {
      if (!promise) {
        promise = importFn()
          .then((module) => {
            status = 'success';
            result = module.default || module;
          })
          .catch((error) => {
            status = 'error';
            result = error;
          });
      }

      return promise;
    };

    // 返回的懒加载组件
    function LazyComponent<P extends React.Attributes = any>(props: P) {
      useLayoutEffect(() => {
        if (status === 'success') {
          onLoaded();
        }
      }, [status]);
      // 根据状态决定行为
      switch (status) {
        case 'success': {
          // 加载成功，渲染实际组件
          const Component = result as React.ComponentType<any>;
          return React.createElement(Component, props);
        }
        case 'error':
          // 加载失败，抛出错误
          throw result;
        case 'pending':
        default:
          // 加载中，抛出 Promise
          throw load();
      }
    }
    // LazyComponent._result = null as any;
    // LazyComponent.$$typeof = Symbol.for('react.lazy');
    // @ts-ignore
    return LazyComponent;
  }
  return lazy;
}
