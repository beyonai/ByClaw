import type { ComponentType, ReactNode } from 'react';

import { SSEMessageType } from '@/constants/message';
import type { IMessage, IMessageListItem } from '@/typescript/message';

export type ThinkingPreviewProps = {
  message: IMessage;
  messageListItemContent: IMessageListItem['content'];
  thinkListItem: IMessageListItem;
};

export type ThinkingPreviewGetter = (props: ThinkingPreviewProps) => ReactNode;

type PreviewableComponent = ComponentType<any> & {
  getThinkingPreview?: ThinkingPreviewGetter;
};

type PreviewableModule = {
  default: PreviewableComponent;
};

// 预览提取器与消息组件使用相同的动态模块，构建产物和浏览器模块缓存都会复用对应代码分块。
// 只有实现了静态 getThinkingPreview 方法的组件才允许注册，否则会无意义地提前加载整个组件代码分块。
const moduleLoaders: Partial<Record<SSEMessageType, () => Promise<PreviewableModule>>> = {
  [SSEMessageType.toolCall]: () => import('@/components/MessagesComp/ToolCall'),
};

const getterPromises = new Map<SSEMessageType, Promise<ThinkingPreviewGetter | null>>();

export const loadThinkingPreviewGetter = (contentType: SSEMessageType) => {
  const cached = getterPromises.get(contentType);
  if (cached) return cached;

  const loader = moduleLoaders[contentType];
  if (!loader) return Promise.resolve(null);

  const promise = loader()
    .then(({ default: component }) => component.getThinkingPreview ?? null)
    .catch(() => {
      // 代码分块加载失败时继续使用通用摘要，并允许下次渲染重新尝试。
      getterPromises.delete(contentType);
      return null;
    });
  getterPromises.set(contentType, promise);
  return promise;
};
