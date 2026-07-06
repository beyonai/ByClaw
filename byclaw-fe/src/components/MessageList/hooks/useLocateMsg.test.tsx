jest.mock('@umijs/max', () => ({
  useSelector: jest.fn(),
}));

jest.mock('@/hooks/useGlobal', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const mockLazyListeners = new Set<() => void>();

jest.mock('../lazyHandler', () => ({
  addLazyCompLoadedListener: jest.fn((fn: () => void) => {
    mockLazyListeners.add(fn);
  }),
  removeLazyCompLoadedListener: jest.fn((fn: () => void) => {
    mockLazyListeners.delete(fn);
  }),
}));

import { act, renderHook } from '@testing-library/react';
import { useSelector } from '@umijs/max';
import useGlobal from '@/hooks/useGlobal';
import { addLazyCompLoadedListener, removeLazyCompLoadedListener } from '../lazyHandler';
import useLocateMsg from './useLocateMsg';

const mockUseSelector = useSelector as jest.Mock;
const mockUseGlobal = useGlobal as jest.MockedFunction<typeof useGlobal>;
const mockAddLazyCompLoadedListener = addLazyCompLoadedListener as jest.MockedFunction<
  typeof addLazyCompLoadedListener
>;
const mockRemoveLazyCompLoadedListener = removeLazyCompLoadedListener as jest.MockedFunction<
  typeof removeLazyCompLoadedListener
>;

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

describe('useLocateMsg', () => {
  let eventHandlers: Record<string, (...args: any[]) => void>;
  let infiniteScrollRef: React.MutableRefObject<any>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLazyListeners.clear();
    document.body.innerHTML = '<div id="scroll-message"></div>';
    eventHandlers = {};
    infiniteScrollRef = {
      current: {
        isLastScrollAtBottom: true,
        scrollToBottom: jest.fn(() => {
          const scroller = document.getElementById('scroll-message');
          if (scroller) {
            scroller.scrollTop = scroller.scrollHeight;
          }
        }),
        scrollByControl: jest.fn(),
      },
    };

    mockUseSelector.mockImplementation((selector: any) =>
      selector({
        messageStore: {
          sessionListMap: new Map([
            [
              's1',
              {
                pageNum: 1,
                pageRange: [1, 2],
              },
            ],
          ]),
        },
      })
    );
    mockUseGlobal.mockReturnValue({
      EventEmitter: {
        on: jest.fn((eventName: string, handler: (...args: any[]) => void) => {
          eventHandlers[eventName] = handler;
        }),
        off: jest.fn(),
      },
    } as any);
    (globalThis as any).requestIdleCallback = (cb: () => void) => {
      cb();
      return 1;
    };
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(jest.fn());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function renderUseLocateMsg() {
    return renderHook(() =>
      useLocateMsg({
        sessionId: 's1',
        messageListLength: 2,
        scrollTargeEleId: 'scroll-message',
        infiniteScrollRef,
        scrollThreshold: 50,
        bottomItemKey: 'm2',
      })
    );
  }

  it('scrolls to bottom on session change when targetMessageId is absent', () => {
    const scroller = document.getElementById('scroll-message')!;
    setScrollMetrics(scroller, {
      clientHeight: 200,
      scrollHeight: 800,
      scrollTop: 100,
    });

    renderUseLocateMsg();

    act(() => {
      eventHandlers.scrollToMsgOnSessionChanged({ sessionId: 's1' });
    });

    expect(infiniteScrollRef.current.scrollToBottom).toHaveBeenCalledWith({
      behavior: 'auto',
    });
    expect(infiniteScrollRef.current.scrollByControl).toHaveBeenCalledWith('down');
  });

  it('scrolls target message into view and syncs bottom-follow state', () => {
    const scroller = document.getElementById('scroll-message')!;
    setScrollMetrics(scroller, {
      clientHeight: 200,
      scrollHeight: 800,
      scrollTop: 200,
    });
    const target = document.createElement('div');
    target.id = 'wrapper_target';
    target.scrollIntoView = jest.fn();
    document.body.appendChild(target);

    renderUseLocateMsg();

    act(() => {
      eventHandlers.scrollToMsgOnSessionChanged({
        sessionId: 's1',
        targetMessageId: 'target',
      });
    });

    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    expect(infiniteScrollRef.current.isLastScrollAtBottom).toBe(false);
    expect(infiniteScrollRef.current.scrollByControl).not.toHaveBeenCalled();
  });

  it('uses lazy component loaded event as a target-message locate retry', () => {
    const scroller = document.getElementById('scroll-message')!;
    setScrollMetrics(scroller, {
      clientHeight: 200,
      scrollHeight: 800,
      scrollTop: 100,
    });

    renderUseLocateMsg();

    act(() => {
      eventHandlers.scrollToMsgOnSessionChanged({ sessionId: 's1', targetMessageId: 'target' });
    });

    const lazyListener = mockAddLazyCompLoadedListener.mock.calls[0][0];
    const target = document.createElement('div');
    target.id = 'wrapper_target';
    target.scrollIntoView = jest.fn();
    document.body.appendChild(target);

    act(() => {
      lazyListener();
    });

    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    expect(mockRemoveLazyCompLoadedListener).toHaveBeenCalledWith(lazyListener);
  });

  it('does not keep lazy locate retry after normal session open without target message', () => {
    const scroller = document.getElementById('scroll-message')!;
    setScrollMetrics(scroller, {
      clientHeight: 200,
      scrollHeight: 800,
      scrollTop: 100,
    });

    renderUseLocateMsg();

    act(() => {
      eventHandlers.scrollToMsgOnSessionChanged({ sessionId: 's1' });
    });

    expect(mockAddLazyCompLoadedListener).not.toHaveBeenCalled();
  });

  it('ignores stale lazy locate callbacks after cleanup', () => {
    const scroller = document.getElementById('scroll-message')!;
    setScrollMetrics(scroller, {
      clientHeight: 200,
      scrollHeight: 800,
      scrollTop: 100,
    });

    const { unmount } = renderUseLocateMsg();

    act(() => {
      eventHandlers.scrollToMsgOnSessionChanged({ sessionId: 's1', targetMessageId: 'target' });
    });

    const lazyListener = mockAddLazyCompLoadedListener.mock.calls[0][0];
    infiniteScrollRef.current.scrollToBottom.mockClear();

    unmount();

    act(() => {
      lazyListener();
    });

    expect(infiniteScrollRef.current.scrollToBottom).not.toHaveBeenCalled();
  });
});
