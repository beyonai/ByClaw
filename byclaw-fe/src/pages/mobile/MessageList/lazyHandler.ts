import React from 'react';
import { ChartMessageType, SSEMessageType } from '@/constants/message';
import createReactLazy from '@/utils/createReactLazy';

const lazyCompLoadedListeners: Array<() => void> = [];

export const addLazyCompLoadedListener = (fn: () => void) => {
  lazyCompLoadedListeners.push(fn);
};

export const removeLazyCompLoadedListener = (fn: () => void) => {
  const index = lazyCompLoadedListeners.indexOf(fn);
  if (index > -1) {
    lazyCompLoadedListeners.splice(index, 1);
  }
};

const lazy = createReactLazy(() => {
  lazyCompLoadedListeners.forEach((fn) => fn());
});

type IType =
  | (typeof SSEMessageType)[keyof typeof SSEMessageType]
  | (typeof ChartMessageType)[keyof typeof ChartMessageType];

const compMap: Record<string, React.LazyExoticComponent<any>> = {
  [`${SSEMessageType.text}`]: lazy(() => import('@/components/MessagesComp/Text')),
  [`${SSEMessageType.noticeTodo}`]: lazy(() => import('@/pages/notice/components/MessageComp/Todo')),
  [`${SSEMessageType.noticeApproval}`]: lazy(() => import('@/pages/notice/components/MessageComp/Approval')),
  [`${SSEMessageType.noticeShare}`]: lazy(() => import('@/pages/notice/components/MessageComp/Share')),
};

class LazyHandler {
  store: Record<string, React.LazyExoticComponent<any>> = {};

  lazyComp = (type: IType) => {
    if (this.store[type]) {
      return this.store[type];
    }
    // return React.Fragment;
    // 动态加载会导致加载分页高度计算不一致，无法定位到原来的滚动条位置，先注释掉
    const comp = compMap[type];
    if (!comp) {
      return null;
    }
    this.store[type] = comp;
    return comp;
  };
}

const lazyHandler = new LazyHandler();
export default lazyHandler;
