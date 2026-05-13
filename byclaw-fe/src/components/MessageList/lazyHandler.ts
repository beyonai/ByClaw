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
  [`${SSEMessageType.form}`]: lazy(() => import('@/components/MessagesComp/Form')),
  [`${SSEMessageType.outline}`]: lazy(() => import('@/components/MessagesComp/Outline')),
  [`${SSEMessageType.employee}`]: lazy(() => import('@/components/MessagesComp/Employee')),
  [`${SSEMessageType.iframe}`]: lazy(() => import('@/components/MessagesComp/Iframe')),
  [`${SSEMessageType.approvalForm}`]: lazy(() => import('@/components/MessagesComp/ApprovalForm')),
  [`${SSEMessageType.taskOutline}`]: lazy(() => import('@/components/MessagesComp/TaskOutline')),
  [`${SSEMessageType.slientHandler}`]: lazy(() => import('@/components/MessagesComp/SlientHandler')),
  [`${SSEMessageType.application}`]: lazy(() => import('@/components/MessagesComp/Application')),
  [`${SSEMessageType.forward}`]: lazy(() => import('@/components/MessagesComp/Forward')),
  [`${SSEMessageType.asr}`]: lazy(() => import('@/components/MessagesComp/Asr')),

  [`${SSEMessageType.thinkText}`]: lazy(() => import('@/components/MessagesComp/Think/ThinkingProcess')),
  [`${SSEMessageType.thinkTitle}`]: lazy(() => import('@/components/MessagesComp/Think/ThinkTitle')),
  [`${SSEMessageType.thinkSubTitle}`]: lazy(() => import('@/components/MessagesComp/Think/ThinkSubTitle')),
  [`${SSEMessageType.thinkStatusTitle}`]: lazy(() => import('@/components/MessagesComp/Think/ThinkStatusTitle')),
  [`${SSEMessageType.thinkRootTitle}`]: lazy(
    () => import('@/components/MessagesComp/Think/ThinkRootTitle/components/ThinkOldRootTitle')
  ),
  [`${SSEMessageType.thinkResource}`]: lazy(() => import('@/components/MessagesComp/Think/ThinkResource')),
  [`${SSEMessageType.thinkResourceFile}`]: lazy(() => import('@/components/MessagesComp/Think/ThinkResourceFile')),
  [`${SSEMessageType.thinkRewriteQuestion}`]: lazy(
    () => import('@/components/MessagesComp/Think/ThinkRewriteQuestion')
  ),

  [`${SSEMessageType.thinkTaskPrepare}`]: lazy(
    () => import('@/components/MessagesComp/Think/ThinkTask/ThinkTaskPrepare')
  ),
  [`${SSEMessageType.thinkTaskExecute}`]: lazy(
    () => import('@/components/MessagesComp/Think/ThinkTask/ThinkTaskExecute')
  ),
  [`${SSEMessageType.thinkTaskResult}`]: lazy(
    () => import('@/components/MessagesComp/Think/ThinkTask/ThinkTaskResult')
  ),
  [`${SSEMessageType.thinkTaskUserInput}`]: lazy(
    () => import('@/components/MessagesComp/Think/ThinkTask/ThinkTaskUserInput')
  ),
  [`${SSEMessageType.dataCloudLogin}`]: lazy(() => import('@/components/MessagesComp/DataCloud/login')),
  [`${SSEMessageType.commonCard}`]: lazy(() => import('@/components/MessagesComp/Card')),
  [`${SSEMessageType.jsonBlock}`]: lazy(() => import('@/components/MessagesComp/JsonBlock')),
};

class LazyHandler {
  store: Record<string, React.LazyExoticComponent<any>> = {};

  lazyComp = (type: IType) => {
    if (this.store[type]) {
      return this.store[type];
    }
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
