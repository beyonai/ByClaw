import { useRef, RefObject, useLayoutEffect, useEffect } from 'react';
import { useSelector } from '@umijs/max';
import { IMessageInfo } from '@/models/useMessageStore';
import { debounceByIdleCallback } from '@/utils/tools';
import { addLazyCompLoadedListener, removeLazyCompLoadedListener } from '../lazyHandler';
import InfiniteScroll from '../../InfiniteScroll';
import useGlobal from '@/hooks/useGlobal';

export default function useLocateMsg(params: {
  sessionId?: string;
  messageListLength: number;
  scrollTargeEleId: string;
  infiniteScrollRef: RefObject<InfiniteScroll | null>;
  scrollThreshold: number;
  bottomItemKey?: string;
}) {
  const { sessionId, messageListLength, scrollTargeEleId, infiniteScrollRef, scrollThreshold, bottomItemKey } = params;
  const previousMessageLength = useRef(messageListLength);
  const onLazyCompLoadedCbRef = useRef<() => void>(undefined);

  const { EventEmitter } = useGlobal();

  const { sessionListMap } = useSelector(
    ({ messageStore }: { messageStore: { sessionListMap: Map<string, IMessageInfo> } }) => ({
      sessionListMap: messageStore.sessionListMap,
    })
  );

  const previousBottomItemKey = useRef(bottomItemKey);
  const pageNum = sessionId ? sessionListMap.get(sessionId)?.pageNum ?? 1 : 1;
  const lowestPageNum = sessionId ? sessionListMap.get(sessionId)?.pageRange[1] ?? 1 : 1;

  useLayoutEffect(() => {
    // 流式输出时，不断向下滚动的效果
    if (
      pageNum === 1 &&
      messageListLength > 0 &&
      previousMessageLength.current === messageListLength &&
      previousBottomItemKey.current !== bottomItemKey &&
      infiniteScrollRef.current?.isLastScrollAtBottom
    ) {
      infiniteScrollRef.current?.scrollToBottom();
    }
    previousMessageLength.current = messageListLength;
    previousBottomItemKey.current = bottomItemKey;
  }, [pageNum, bottomItemKey]);

  useEffect(() => {
    const scrollToMsgOnSessionChanged = async (params: {
      // sessionId: string,
      targetMessageId?: string;
    }) => {
      const { targetMessageId } = params;
      const scrollerElement = document.getElementById(scrollTargeEleId);
      if (targetMessageId) {
        // 打开会话，需要滚动到指定msg
        const targetMsgId = `wrapper_${targetMessageId}`;
        const element = document.getElementById(targetMsgId);
        if (element) {
          element.scrollIntoView({ block: 'start' });
        }
        if (scrollerElement) {
          if (scrollerElement.scrollTop <= scrollThreshold) {
            // 滚动到指定msg位置后，这时候已经触顶了，需要请求下一页
            infiniteScrollRef.current?.scrollByControl('up');
          } else if (
            scrollerElement.scrollTop >=
            scrollerElement.scrollHeight - scrollerElement.clientHeight - scrollThreshold
          ) {
            // 滚动到指定msg位置后，这时候已经触底了，需要请求上一页
            infiniteScrollRef.current?.scrollByControl('down');
          }
        }
      } else if (scrollerElement) {
        // 正常打开会话，默认滚动到底部
        scrollerElement.scrollTop = scrollerElement.scrollHeight;
        // 虽然没有targetMessageId，但这个会话可能经过这样的步骤：
        // 1. 通过【查看详情】的方式定位到某个msg
        // 2. 切换到其他会话
        // 3. 再切换回来
        // 这种情况下，由于走的是缓存，其pageNum仍然可能大于1，这时候还是要尝试请求上一页的
        infiniteScrollRef.current?.scrollByControl('down');
      }
      removeLazyCompLoadedListener(onLazyCompLoadedCbRef.current!);
      onLazyCompLoadedCbRef.current = undefined;
    };

    const onSessionChange = (params: { sessionId: string; targetMessageId?: string }) => {
      onLazyCompLoadedCbRef.current = debounceByIdleCallback(() => {
        scrollToMsgOnSessionChanged(params);
        removeLazyCompLoadedListener(onLazyCompLoadedCbRef.current!);
        onLazyCompLoadedCbRef.current = undefined;
      });
      addLazyCompLoadedListener(onLazyCompLoadedCbRef.current);
    };

    EventEmitter.on('scrollToMsgOnSessionChanged', onSessionChange);
    return () => {
      EventEmitter.off('scrollToMsgOnSessionChanged', onSessionChange);
    };
  }, [EventEmitter]);

  return { pageNum, lowestPageNum };
}
