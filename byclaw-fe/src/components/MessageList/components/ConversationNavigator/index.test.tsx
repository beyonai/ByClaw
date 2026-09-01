import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { IMessage } from '@/typescript/message';
import ConversationNavigator from '.';

const mockDispatch = jest.fn();
const mockGetMessageOutline = jest.fn();

jest.mock('@umijs/max', () => ({
  useDispatch: () => mockDispatch,
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => id,
  }),
}));

jest.mock('antd', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('@/hooks/useGlobal', () => ({
  __esModule: true,
  default: () => ({ EventEmitter: { emit: jest.fn() } }),
}));

jest.mock('@/service/message', () => ({
  getMessageOutline: (...args: unknown[]) => mockGetMessageOutline(...args),
}));

const messageList = ['first', 'second', 'third'].map(
  (text, index) =>
    ({
      messageId: `${index + 1}`,
      msgId: `${index + 1}`,
      usage: '1',
      fromBeyond: false,
      text,
    } as IMessage)
);

describe('ConversationNavigator', () => {
  let host: HTMLDivElement;
  let scroller: HTMLDivElement;
  let requestAnimationFrameSpy: jest.SpyInstance;
  let cancelAnimationFrameSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetMessageOutline.mockResolvedValue([]);

    class MockResizeObserver {
      observe = jest.fn();

      disconnect = jest.fn();
    }

    Object.defineProperty(global, 'ResizeObserver', {
      configurable: true,
      value: MockResizeObserver,
    });
    requestAnimationFrameSpy = jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    cancelAnimationFrameSpy = jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(jest.fn());

    host = document.createElement('div');
    scroller = document.createElement('div');
    scroller.id = 'message-scroller';
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 500 });
    Object.defineProperty(scroller, 'scrollTo', { configurable: true, value: jest.fn() });
    scroller.getBoundingClientRect = () => ({ top: 100 } as DOMRect);
    host.appendChild(scroller);
    document.body.appendChild(host);

    [120, 360, 620].forEach((top, index) => {
      const message = document.createElement('div');
      message.id = `wrapper_${index + 1}`;
      message.getBoundingClientRect = () => ({ top } as DOMRect);
      scroller.appendChild(message);
    });
  });

  afterEach(() => {
    requestAnimationFrameSpy.mockRestore();
    cancelAnimationFrameSpy.mockRestore();
    host.remove();
  });

  it('keeps the clicked marker selected during programmatic scrolling', async () => {
    render(
      <ConversationNavigator sessionId="session-1" messageList={messageList} scrollContainerId="message-scroller" />
    );

    const markers = screen.getAllByRole('button');
    await waitFor(() => expect(markers[0]).toHaveAttribute('aria-current', 'location'));

    fireEvent.click(markers[2]);
    expect(markers[2]).toHaveAttribute('aria-current', 'location');

    fireEvent.scroll(scroller);
    expect(markers[2]).toHaveAttribute('aria-current', 'location');

    fireEvent.wheel(scroller);
    fireEvent.scroll(scroller);
    expect(markers[0]).toHaveAttribute('aria-current', 'location');
  });
});
