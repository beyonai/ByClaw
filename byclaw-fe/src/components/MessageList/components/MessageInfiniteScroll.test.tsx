import React from 'react';
import { act, render } from '@testing-library/react';
import MessageInfiniteScroll from './MessageInfiniteScroll';

type ResizeObserverCb = ResizeObserverCallback;

const resizeCallbacks: ResizeObserverCb[] = [];

function setScrollMetrics(
  element: HTMLElement,
  metrics: {
    clientHeight: number;
    scrollHeight: number;
    scrollTop?: number;
  }
) {
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    value: metrics.clientHeight,
  });
  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    value: metrics.scrollHeight,
  });
  if (typeof metrics.scrollTop === 'number') {
    element.scrollTop = metrics.scrollTop;
  }
}

function renderMessageInfiniteScroll(props?: Partial<React.ComponentProps<typeof MessageInfiniteScroll>>) {
  const ref = React.createRef<MessageInfiniteScroll>();
  const result = render(
    <div id="scroll-target" data-testid="scroll-target">
      <MessageInfiniteScroll
        ref={ref}
        next={jest.fn()}
        hasMore={false}
        loader={<div>loading</div>}
        dataLength={1}
        scrollableTarget="scroll-target"
        inverse
        scrollThreshold="50px"
        bottomItemKey="m1"
        topItemKey="m1"
        appendItemsAutoScrollBottom={false}
        {...props}
      >
        <div>message</div>
      </MessageInfiniteScroll>
    </div>
  );

  const scroller = result.getByTestId('scroll-target');
  const scrollTo = jest.fn(({ top }: ScrollToOptions) => {
    scroller.scrollTop = top || 0;
  });
  Object.defineProperty(scroller, 'scrollTo', {
    configurable: true,
    value: scrollTo,
  });

  return {
    ...result,
    ref,
    scroller,
    scrollTo,
  };
}

describe('MessageInfiniteScroll', () => {
  let requestAnimationFrameSpy: jest.SpyInstance;
  let cancelAnimationFrameSpy: jest.SpyInstance;

  beforeEach(() => {
    resizeCallbacks.length = 0;
    class MockResizeObserver {
      private cb: ResizeObserverCb;

      constructor(cb: ResizeObserverCb) {
        this.cb = cb;
        resizeCallbacks.push(this.cb);
      }

      observe = jest.fn();

      disconnect = jest.fn();
    }

    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: MockResizeObserver,
    });
    Object.defineProperty(global, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: MockResizeObserver,
    });
    requestAnimationFrameSpy = jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    cancelAnimationFrameSpy = jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(jest.fn());
  });

  afterEach(() => {
    requestAnimationFrameSpy.mockRestore();
    cancelAnimationFrameSpy.mockRestore();
  });

  it('keeps the list at bottom when content resizes while following bottom', () => {
    const { scroller, scrollTo } = renderMessageInfiniteScroll();

    setScrollMetrics(scroller, {
      clientHeight: 200,
      scrollHeight: 700,
      scrollTop: 300,
    });

    act(() => {
      resizeCallbacks[0]?.([], {} as ResizeObserver);
    });

    expect(scrollTo).toHaveBeenCalledWith({
      behavior: 'auto',
      top: 700,
    });
    expect(scroller.scrollTop).toBe(700);
  });

  it('does not force bottom after the user scrolls upward', () => {
    const { ref, scroller, scrollTo } = renderMessageInfiniteScroll();

    setScrollMetrics(scroller, {
      clientHeight: 200,
      scrollHeight: 700,
      scrollTop: 120,
    });

    act(() => {
      (ref.current as any).bindScroll({
        target: scroller,
        isTrusted: true,
      });
    });

    expect(ref.current?.isLastScrollAtBottom).toBe(false);

    act(() => {
      resizeCallbacks[0]?.([], {} as ResizeObserver);
    });

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('resumes bottom following after scrollToBottom is called', () => {
    const { ref, scroller, scrollTo } = renderMessageInfiniteScroll();

    setScrollMetrics(scroller, {
      clientHeight: 200,
      scrollHeight: 700,
      scrollTop: 120,
    });

    act(() => {
      (ref.current as any).bindScroll({
        target: scroller,
        isTrusted: true,
      });
    });
    expect(ref.current?.isLastScrollAtBottom).toBe(false);

    act(() => {
      ref.current?.scrollToBottom({ behavior: 'auto' });
    });

    expect(ref.current?.isLastScrollAtBottom).toBe(true);

    setScrollMetrics(scroller, {
      clientHeight: 200,
      scrollHeight: 900,
      scrollTop: 700,
    });

    act(() => {
      resizeCallbacks[0]?.([], {} as ResizeObserver);
    });

    expect(scrollTo).toHaveBeenLastCalledWith({
      behavior: 'auto',
      top: 900,
    });
  });

  it('preserves scroll position when older messages are loaded above', () => {
    const { ref, scroller, rerender } = renderMessageInfiniteScroll({
      hasMore: true,
      dataLength: 2,
      bottomItemKey: 'm2',
      topItemKey: 'm1',
    });

    setScrollMetrics(scroller, {
      clientHeight: 200,
      scrollHeight: 600,
      scrollTop: 50,
    });

    act(() => {
      (ref.current as any).onScrollListener(
        {
          target: scroller,
          isTrusted: true,
        },
        'up'
      );
    });

    setScrollMetrics(scroller, {
      clientHeight: 200,
      scrollHeight: 900,
      scrollTop: 50,
    });

    rerender(
      <div id="scroll-target" data-testid="scroll-target">
        <MessageInfiniteScroll
          ref={ref}
          next={jest.fn()}
          hasMore
          loader={<div style={{ height: 20 }}>loading</div>}
          dataLength={3}
          scrollableTarget="scroll-target"
          inverse
          scrollThreshold="50px"
          bottomItemKey="m2"
          topItemKey="m0"
          appendItemsAutoScrollBottom={false}
        >
          <div>older message</div>
          <div>message</div>
        </MessageInfiniteScroll>
      </div>
    );

    expect(scroller.scrollTop).toBe(300);
  });
});
