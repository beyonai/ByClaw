import { webcrypto } from 'node:crypto';
import { message } from 'antd';
import { act, renderHook } from '@testing-library/react';
import useDictation from './useDictation';

const mockGetConfig = jest.fn();
const mockGetUserMedia = jest.fn();
const mockStopTrack = jest.fn();
const mockCloseRecorder = jest.fn();
let mockSendChunk: (bytes: Uint8Array) => void;

jest.mock('@/service/common/request', () => ({
  POST: (...args: unknown[]) => mockGetConfig(...args),
}));
jest.mock('@/utils/auth', () => ({ getToken: () => 'browser-token' }));
jest.mock('@/utils/encrypt/sm', () => ({ decryptBySM: (value: string) => value.replace('encoded-', '') }));
jest.mock('@umijs/max', () => ({ useIntl: () => require('@/testUtils/localeIntl').getLocaleIntl('zh-CN') }));
jest.mock('recorder-core', () => ({
  __esModule: true,
  default: ({ takeoffEncodeChunk }: { takeoffEncodeChunk: typeof mockSendChunk }) => {
    mockSendChunk = takeoffEncodeChunk;
    return { open: (opened: () => void) => opened(), start: jest.fn(), close: mockCloseRecorder };
  },
}));
jest.mock('recorder-core/src/engine/pcm', () => ({}));

class TestSocket {
  static OPEN = 1;
  static last?: TestSocket;

  readyState = TestSocket.OPEN;
  onopen?: () => void;
  onclose?: (event: { wasClean: boolean }) => void;
  onmessage?: (event: { data: string }) => void;
  close = jest.fn();
  send = jest.fn();

  constructor(readonly url: string) {
    TestSocket.last = this;
  }

  emit(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  result(text: string, sn: number, status = 1, replacement?: [number, number]) {
    this.emit({
      header: { code: 0, status },
      payload: {
        result: {
          text: btoa(
            JSON.stringify({
              sn,
              ws: [{ cw: [{ w: text }] }],
              ...(replacement ? { pgs: 'rpl', rg: replacement } : {}),
            })
          ),
        },
      },
    });
  }

  receive(data: ArrayBuffer) {
    (this.onmessage as ((event: { data: ArrayBuffer }) => void) | undefined)?.({ data });
  }
}

const realWebSocket = window.WebSocket;
const originalSubtle = Object.getOwnPropertyDescriptor(window.crypto, 'subtle');

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(window.crypto, 'subtle', { configurable: true, value: webcrypto.subtle });
  jest.useFakeTimers();
  window.WebSocket = TestSocket as unknown as typeof WebSocket;
  TestSocket.last = undefined;
  mockGetConfig.mockResolvedValue({
    paramValue: JSON.stringify({
      type: 'xunfei-spark-asr-v2',
      appIdEncrypted: 'encoded-app',
      credentials: { apiKeyEncrypted: 'encoded-key', apiSecretEncrypted: 'encoded-secret' },
    }),
  });
  mockGetUserMedia.mockReset().mockResolvedValue({
    getTracks: () => [{ stop: mockStopTrack, addEventListener: jest.fn() }],
  });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: mockGetUserMedia } });
});

afterEach(() => {
  jest.useRealTimers();
  window.WebSocket = realWebSocket;
  if (originalSubtle) Object.defineProperty(window.crypto, 'subtle', originalSubtle);
  else Reflect.deleteProperty(window.crypto, 'subtle');
});

it('streams Spark V2 frames and applies dynamic replacement before inserting the final result', async () => {
  const insert = jest.fn();
  const { result } = renderHook(() => useDictation(() => insert));
  await act(async () => result.current.start());
  expect(mockGetConfig).toHaveBeenCalledWith(
    '/byaiService/system/staticdata/getDcSystemConfig',
    { paramCode: 'VOICE_STREAM_SERVICE_CONFIG' },
    { responseCfg: { hideErrorTips: true } }
  );
  const socket = TestSocket.last!;
  const url = new URL(socket.url);
  expect(url.origin + url.pathname).toBe('wss://iat.cn-huabei-1.xf-yun.com/v1');
  expect(atob(url.searchParams.get('authorization')!)).toContain('api_key="key"');
  act(() => {
    socket.onopen?.();
    mockSendChunk(new Uint8Array(1282));
    socket.result('draft', 1);
    socket.result('corrected', 2, 1, [1, 1]);
    result.current.stop();
    jest.advanceTimersByTime(90);
    socket.result(' result', 3, 2);
  });
  const frames = socket.send.mock.calls.map(([frame]) => JSON.parse(frame));
  expect(frames[0]).toMatchObject({
    header: { app_id: 'app', status: 0 },
    parameter: { iat: { domain: 'spark_asr_v2', dwa: 'wpgs' } },
  });
  expect(frames.map((frame) => frame.payload.audio.seq)).toEqual([1, 2, 3]);
  expect(frames.map((frame) => atob(frame.payload.audio.audio).length)).toEqual([1280, 2, 0]);
  expect(insert.mock.calls).toEqual([
    ['draft', true],
    ['corrected', true],
    ['corrected result', true],
    ['corrected result'],
  ]);
});

it('uses the authenticated same-origin relay for Volcengine binary frames and final snapshots', async () => {
  mockGetConfig.mockResolvedValueOnce({
    paramValue: JSON.stringify({
      type: 'volcengine-streaming-asr-v2',
      resourceId: 'volc.seedasr.sauc.duration',
      credentials: { apiKeyEncrypted: 'never-send-this' },
    }),
  });
  const insert = jest.fn();
  const { result } = renderHook(() => useDictation(() => insert));
  await act(async () => result.current.start());
  const socket = TestSocket.last!;
  expect(new URL(socket.url).pathname).toBe('/byaiService/voice/stream');
  expect(new URL(socket.url).search).toBe('');
  act(() => socket.onopen?.());
  expect(JSON.parse(socket.send.mock.calls[0][0])).toEqual({ token: 'browser-token' });
  expect(result.current.status).toBe('voice.dictationConnecting');
  function receive(flags: number, text: string) {
    const body = new TextEncoder().encode(JSON.stringify({ result: { text } }));
    const packet = new Uint8Array(8 + body.length);
    packet.set([0x11, 0x90 | flags, 0x10, 0]);
    new DataView(packet.buffer).setUint32(4, body.length);
    packet.set(body, 8);
    socket.receive(packet.buffer);
  }
  act(() => {
    socket.emit({ ready: true });
    mockSendChunk(new Uint8Array(6400));
    receive(0, 'preview');
    result.current.stop();
    jest.advanceTimersByTime(210);
    receive(2, 'final');
  });
  expect(socket.send.mock.calls.slice(1).map(([frame]) => new Uint8Array(frame)[1])).toEqual([0x20, 0x22]);
  expect(insert.mock.calls).toEqual([['preview', true], ['final', true], ['final']]);
});

it('keeps visible dictation text when the controls are closed', async () => {
  const insert = jest.fn();
  const { result } = renderHook(() => useDictation(() => insert));
  await act(async () => result.current.start());
  const socket = TestSocket.last!;
  act(() => {
    socket.onopen?.();
    socket.result('visible', 1);
    result.current.close();
  });
  expect(insert.mock.calls).toEqual([['visible', true], ['visible']]);
  expect(result.current.active).toBe(false);
  expect(socket.close).toHaveBeenCalledTimes(1);
});

it('ignores a result from the old dictation after its input is unmounted', async () => {
  const insert = jest.fn();
  const { result, unmount } = renderHook(() => useDictation(() => insert));
  await act(async () => result.current.start());
  const socket = TestSocket.last!;
  act(() => socket.onopen?.());
  const receive = socket.onmessage;
  unmount();
  receive?.({ data: JSON.stringify({ action: 'started', code: '0' }) });
  expect(insert.mock.calls).toEqual([[undefined]]);
  expect(mockCloseRecorder).toHaveBeenCalledTimes(1);
  expect(mockStopTrack).toHaveBeenCalledTimes(1);
  expect(socket.close).toHaveBeenCalledTimes(1);
});

it('shows configuration loading and microphone permission separately, and reads fresh configuration on retry', async () => {
  const config = await mockGetConfig();
  mockGetConfig.mockClear();
  let resolveConfig: (value: typeof config) => void = () => undefined;
  mockGetConfig.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveConfig = resolve;
      })
  );
  let grantPermission: (value: unknown) => void = () => undefined;
  mockGetUserMedia.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        grantPermission = resolve;
      })
  );
  const { result } = renderHook(() => useDictation());
  let start: Promise<void>;
  act(() => {
    start = result.current.start();
  });
  expect(result.current.status).toBe('voice.dictationLoadingConfig');
  expect(mockGetUserMedia).not.toHaveBeenCalled();
  await act(async () => {
    resolveConfig(config);
    await start;
  });
  expect(result.current.status).toBe('voice.microphoneWaiting');
  act(() => result.current.cancel());
  await act(async () => grantPermission({ getTracks: () => [{ stop: mockStopTrack }] }));
  expect(mockStopTrack).toHaveBeenCalledTimes(1);
  await act(async () => result.current.start());
  expect(mockGetConfig).toHaveBeenCalledTimes(2);
  expect(result.current.status).toBe('voice.dictationConnecting');
});

it.each([
  [undefined, /尚未配置语音转写/],
  ['{broken', /语音转写配置有误/],
  ['{"type":"xunfei-iat-v2"}', /语音转写配置有误/],
  ['{"type":"volcengine-streaming-asr-v2","resourceId":"volc.bigasr.sauc.duration"}', /语音转写配置有误/],
])('distinguishes absent and invalid managed settings', async (paramValue, hint) => {
  const error = jest.spyOn(message, 'error').mockImplementation(jest.fn());
  try {
    mockGetConfig.mockResolvedValueOnce({ paramValue });
    const { result } = renderHook(() => useDictation());
    await act(async () => result.current.start());
    expect(error).toHaveBeenCalledWith(expect.stringMatching(hint));
    expect(mockGetUserMedia).not.toHaveBeenCalled();
  } finally {
    error.mockRestore();
  }
});

it('reports a handshake timeout as a connection problem', async () => {
  const error = jest.spyOn(message, 'error').mockImplementation(jest.fn());
  try {
    const { result } = renderHook(() => useDictation());
    await act(async () => result.current.start());
    act(() => jest.advanceTimersByTime(10000));
    expect(error).toHaveBeenCalledWith(expect.stringContaining('等待转写连接确认超时'));
  } finally {
    error.mockRestore();
  }
});
