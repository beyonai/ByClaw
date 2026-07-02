import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';

import TitleWriter from './index';

const mockUseSelector = jest.fn();
const mockEventHandlers = new Map<string, (payload: any) => void>();

jest.mock('@umijs/max', () => ({
  useSelector: (selector: (state: any) => any) => mockUseSelector(selector),
}));

jest.mock('@/hooks/useGlobal', () => ({
  __esModule: true,
  default: () => ({
    EventEmitter: {
      on: jest.fn((eventName: string, handler: (payload: any) => void) => {
        mockEventHandlers.set(eventName, handler);
      }),
      off: jest.fn((eventName: string) => {
        mockEventHandlers.delete(eventName);
      }),
    },
  }),
}));

jest.mock('@/utils', () => ({
  getRuntimeActualUrl: (url: string) => url,
}));

jest.mock('@/utils/system', () => ({
  getSystemConfigByStorage: () => ({}),
}));

describe('TitleWriter assistant tips', () => {
  const videoLoadMock = jest.fn();
  const videoPlayMock = jest.fn();
  const consoleError = console.error;
  let consoleErrorSpy: jest.SpyInstance;

  beforeAll(() => {
    Object.defineProperty(window.HTMLMediaElement.prototype, 'load', {
      configurable: true,
      value: videoLoadMock,
    });
    Object.defineProperty(window.HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: videoPlayMock,
    });
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown, ...args: unknown[]) => {
      const text = [message, ...args].join(' ');
      if (text.includes('React does not recognize') && text.includes('fetchPriority')) {
        return;
      }

      consoleError(message, ...args);
    });
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockEventHandlers.clear();
    videoPlayMock.mockResolvedValue(undefined);
    mockUseSelector.mockImplementation((selector: (state: any) => any) => selector({ user: { userInfo: null } }));
  });

  function renderTitleWriter() {
    render(<TitleWriter title="title" colorTitle="color" fullText="" showAssistant showAssistantTips />);
  }

  function emitAssistantTips(tips: string | Array<{ tips: string }>) {
    act(() => {
      mockEventHandlers.get('beyond-titlewriter-set-assistanttips')?.(typeof tips === 'string' ? { tips } : tips);
    });
  }

  it('waits for video canplay before showing the assistant tips bubble', async () => {
    renderTitleWriter();

    emitAssistantTips('Zed');

    expect(screen.queryByText('Z')).not.toBeInTheDocument();

    const video = document.querySelector('video') as HTMLVideoElement;
    fireEvent.canPlay(video);

    expect(await screen.findByText('Z')).toBeInTheDocument();
    expect(videoPlayMock).toHaveBeenCalledTimes(1);
  });

  it('waits for video canplay before showing each assistant tips bubble', async () => {
    renderTitleWriter();

    emitAssistantTips([{ tips: 'One' }, { tips: 'Zed' }]);

    const video = document.querySelector('video') as HTMLVideoElement;
    fireEvent.canPlay(video);
    expect(await screen.findByText('O')).toBeInTheDocument();

    fireEvent.click(screen.getByText('O').closest('div') as HTMLElement);

    expect(screen.queryByText('Z')).not.toBeInTheDocument();

    fireEvent.canPlay(video);

    expect(await screen.findByText('Z')).toBeInTheDocument();
    expect(videoPlayMock).toHaveBeenCalledTimes(2);
  });

  it('shows the assistant tips bubble when video loading fails', async () => {
    renderTitleWriter();

    emitAssistantTips('Zed');

    expect(screen.queryByText('Z')).not.toBeInTheDocument();

    const video = document.querySelector('video') as HTMLVideoElement;
    fireEvent.error(video);

    expect(await screen.findByText('Z')).toBeInTheDocument();
  });

  it('auto plays once after video canplay when userInfo exists and there are no assistant tips', () => {
    mockUseSelector.mockImplementation((selector: (state: any) => any) =>
      selector({ user: { userInfo: { userName: 'Tester' } } })
    );
    renderTitleWriter();

    const video = document.querySelector('video') as HTMLVideoElement;

    expect(videoPlayMock).not.toHaveBeenCalled();

    fireEvent.canPlay(video);
    fireEvent.canPlay(video);

    expect(videoPlayMock).toHaveBeenCalledTimes(1);
  });
});
