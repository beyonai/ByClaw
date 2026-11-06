import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';

import IframeRender from './IframeRender';

jest.mock('antd', () => ({ Spin: ({ children }: { children: ReactNode }) => <>{children}</> }));

const url = 'https://desktop.example.test/view/?token=test';
const origin = 'https://desktop.example.test';

function send(iframe: HTMLIFrameElement, data: unknown, messageOrigin = origin, source = iframe.contentWindow) {
  fireEvent(window, new MessageEvent('message', { source, origin: messageOrigin, data }));
}

function message(channelId: string, attemptId: number, state?: string) {
  return {
    type: 'beyond-iframe-receive-payload',
    data: {
      type: state ? 'connection-state-change' : 'connection-observation-reset',
      data: { version: 1, channelId, attemptId, ...(state ? { state } : {}) },
    },
  };
}

function mount(extra = {}) {
  const onConnectionStateChange = jest.fn();
  const result = render(
    <IframeRender url={url} connectionBridge onConnectionStateChange={onConnectionStateChange} {...extra} />
  );
  const iframe = result.container.querySelector('iframe')!;
  const post = jest.spyOn(iframe.contentWindow!, 'postMessage').mockImplementation(() => {});
  fireEvent.load(iframe);
  const currentChannel = () => post.mock.calls[post.mock.calls.length - 1]?.[0]?.data?.bridge?.channelId;
  return { ...result, iframe, post, onConnectionStateChange, currentChannel };
}

describe('IframeRender connection bridge', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    cleanup();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('requires the current frame, origin and document channel before reporting connected', () => {
    const view = mount();
    const channel = view.currentChannel();
    expect(typeof channel).toBe('string');
    send(view.iframe, message(channel, 1, 'connected'), origin, window);
    send(view.iframe, message(channel, 1, 'connected'), 'https://untrusted.example.test');
    send(view.iframe, message('old-document', 1, 'connected'));
    expect(view.onConnectionStateChange).not.toHaveBeenCalledWith(expect.objectContaining({ state: 'connected' }));
    send(view.iframe, message(channel, 1, 'connected'));
    expect(view.onConnectionStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: 'connected', attemptId: 1 })
    );
  });

  it('invalidates old connected on a new attempt and ignores old or duplicate reset messages', () => {
    const view = mount();
    const channel = view.currentChannel();
    send(view.iframe, message(channel, 1, 'connected'));
    send(view.iframe, message(channel, 2));
    expect(view.onConnectionStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'connecting' }));
    send(view.iframe, message(channel, 1, 'disconnected'));
    send(view.iframe, message(channel, 2, 'connected'));
    send(view.iframe, message(channel, 2));
    expect(view.onConnectionStateChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: 'connected', attemptId: 2 })
    );
  });

  it('has a bounded timeout even if the frame never loads or unconfirmed redirects keep loading', () => {
    const onConnectionStateChange = jest.fn();
    const { container } = render(
      <IframeRender url={url} connectionBridge onConnectionStateChange={onConnectionStateChange} />
    );
    const iframe = container.querySelector('iframe')!;
    act(() => jest.advanceTimersByTime(10000));
    fireEvent.load(iframe);
    act(() => jest.advanceTimersByTime(4000));
    fireEvent.load(iframe);
    act(() => jest.advanceTimersByTime(1000));
    expect(onConnectionStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'unknown' }));
  });

  it('resends initialization finitely until acknowledgement, and rotates channel once per load', () => {
    const onLoad = jest.fn();
    const view = mount({ onLoad });
    const first = view.currentChannel();
    expect(onLoad).toHaveBeenCalledTimes(1);
    act(() => jest.advanceTimersByTime(3000));
    expect(view.post).toHaveBeenCalledTimes(4);
    send(view.iframe, message(first, 1, 'connected'));
    fireEvent.load(view.iframe);
    expect(onLoad).toHaveBeenCalledTimes(2);
    expect(view.currentChannel()).not.toBe(first);
    expect(view.onConnectionStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'connecting' }));
    send(view.iframe, message(first, 1, 'disconnected'));
    expect(view.onConnectionStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'connecting' }));
  });

  it('initializes explicitly allowed redirected origins without wildcard targets', () => {
    const view = mount({ allowedOrigins: ['https://redirect.example.test'] });
    expect(view.post.mock.calls.map((call) => call[1])).toEqual([origin, 'https://redirect.example.test']);
    send(view.iframe, message(view.currentChannel(), 1, 'connected'), 'https://redirect.example.test');
    expect(view.onConnectionStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'connected' }));
  });

  it('preserves ordinary iframe messages while rejecting another iframe source', async () => {
    const onMessage = jest.fn();
    const { container } = render(<IframeRender url="about:blank" onMessage={onMessage} />);
    const iframe = container.querySelector('iframe')!;
    await act(async () => {
      await Promise.resolve();
    });
    const payload = { type: 'beyond-iframe-receive-payload', data: { type: 'preview-action', data: 1 } };
    send(iframe, payload, window.location.origin, window);
    expect(onMessage).not.toHaveBeenCalled();
    send(iframe, payload, window.location.origin);
    expect(onMessage).toHaveBeenCalledWith({ type: 'preview-action', data: 1 });
    send(iframe, null, window.location.origin);
  });
});
