import { message } from 'antd';
import { act, renderHook } from '@testing-library/react';
import useDictation from './useDictation';

const mockGetConfig = jest.fn();
const mockGetUserMedia = jest.fn();
const mockStopTrack = jest.fn();
const mockCloseRecorder = jest.fn();
let mockSendChunk: (bytes: Uint8Array) => void;

jest.mock('@/pages/manager/service/session', () => ({
  getDcSystemConfig: (...args: unknown[]) => mockGetConfig(...args),
}));
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

  result(text: string, id: number, type = '0') {
    this.emit({
      action: 'result',
      code: '0',
      data: JSON.stringify({
        seg_id: id,
        cn: { st: { type, rt: [{ ws: [{ cw: [{ w: text }] }] }] } },
      }),
    });
  }
}

const realWebSocket = window.WebSocket;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  window.WebSocket = TestSocket as unknown as typeof WebSocket;
  TestSocket.last = undefined;
  mockGetConfig.mockResolvedValue({
    paramValue: JSON.stringify({
      services: {
        realtimeTranscription: {
          protocol: 'rtasr-standard-v1',
          appIdEncrypted: 'encoded-app',
          credentials: { apiKeyEncrypted: 'encoded-key' },
          endpoints: { stream: 'wss://rtasr.xfyun.cn/v1/ws' },
        },
      },
    }),
  });
  mockGetUserMedia.mockResolvedValue({
    getTracks: () => [{ stop: mockStopTrack, addEventListener: jest.fn() }],
  });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: mockGetUserMedia } });
});

afterEach(() => {
  jest.useRealTimers();
  window.WebSocket = realWebSocket;
});

it('uses the IAT handshake and inserts the final segment when speech dictation is configured', async () => {
  mockGetConfig.mockResolvedValueOnce({
    paramValue: JSON.stringify({
      services: {
        speechDictation: {
          protocol: 'iat-v2',
          appIdEncrypted: 'encoded-app',
          credentials: { apiKeyEncrypted: 'encoded-key', apiSecretEncrypted: 'encoded-secret' },
          endpoints: { stream: 'wss://iat-api.xfyun.cn/v2/iat' },
        },
      },
    }),
  });
  const insert = jest.fn();
  const { result } = renderHook(() => useDictation(() => insert));
  await act(async () => result.current.start());
  const socket = TestSocket.last!;
  const url = new URL(socket.url);
  expect(url.origin + url.pathname).toBe('wss://iat-api.xfyun.cn/v2/iat');
  expect(atob(url.searchParams.get('authorization')!)).toContain('api_key="key"');
  act(() => {
    socket.onopen?.();
    mockSendChunk(new Uint8Array(1280));
    socket.emit({ code: 0, data: { status: 1, result: { sn: 1, pgs: 'apd', ws: [{ cw: [{ w: '上嗨' }] }] } } });
  });
  expect(insert).toHaveBeenLastCalledWith('上嗨', true);
  act(() => {
    socket.emit({
      code: 0,
      data: { status: 1, result: { sn: 2, pgs: 'rpl', rg: [1, 1], ws: [{ cw: [{ w: '上海' }] }] } },
    });
  });
  expect(insert).toHaveBeenLastCalledWith('上海', true);
  act(() => {
    socket.emit({ code: 0, data: { status: 2, result: { sn: 3, pgs: 'apd', ws: [{ cw: [{ w: '天气' }] }] } } });
  });
  expect(JSON.parse(socket.send.mock.calls[0][0])).toMatchObject({
    common: { app_id: 'app' },
    business: { dwa: 'wpgs' },
  });
  expect(insert).toHaveBeenLastCalledWith('上海天气');
});

it('loads the managed config and inserts final RTASR results only after the server closes', async () => {
  const insert = jest.fn();
  jest.setSystemTime(1512041814000);
  const { result } = renderHook(() => useDictation(() => insert));
  expect(mockGetConfig).not.toHaveBeenCalled();
  await act(async () => result.current.start());
  expect(mockGetConfig).toHaveBeenCalledWith(
    { paramCode: 'XUNFEI_SERVICE_CONFIG' },
    { responseCfg: { hideErrorTips: true } }
  );
  const socket = TestSocket.last!;
  const url = new URL(socket.url);
  expect(url.origin + url.pathname).toBe('wss://rtasr.xfyun.cn/v1/ws');
  expect(Object.fromEntries(url.searchParams)).toEqual({
    appid: 'app',
    ts: '1512041814',
    signa: '8lxwt22MNkgxbnjJ9CqC7oPoD1E=',
  });
  act(() => socket.onopen?.());
  expect(result.current.status).toBe('voice.dictationConnecting');
  act(() => {
    socket.emit({ action: 'started', code: '0' });
    mockSendChunk(new Uint8Array(1286));
    socket.result('临时结果', 1, '1');
    socket.result('你好', 1);
    socket.result('你好', 1);
    result.current.stop();
  });
  expect(mockStopTrack).toHaveBeenCalledTimes(1);
  expect(insert.mock.calls).toEqual([['你好', true]]);
  expect(socket.send.mock.calls[0][0]).toBeInstanceOf(Uint8Array);
  expect(socket.send.mock.calls[0][0]).toHaveLength(1280);
  act(() => jest.advanceTimersByTime(80));
  expect(socket.send.mock.calls[1][0]).toHaveLength(6);
  expect(String.fromCharCode(...socket.send.mock.calls[2][0])).toBe('{"end":true}');
  act(() => {
    socket.result('世界', 2);
    socket.onclose?.({ wasClean: true });
  });
  expect(insert.mock.calls).toEqual([['你好', true], ['你好世界', true], ['你好世界']]);
});

it('keeps visible dictation text when the controls are closed', async () => {
  const insert = jest.fn();
  const { result } = renderHook(() => useDictation(() => insert));
  await act(async () => result.current.start());
  const socket = TestSocket.last!;
  act(() => {
    socket.onopen?.();
    socket.emit({ action: 'started', code: '0' });
    socket.result('已经识别的文字', 1);
    result.current.close();
  });
  expect(insert.mock.calls).toEqual([['已经识别的文字', true], ['已经识别的文字']]);
  expect(result.current.active).toBe(false);
  expect(socket.close).toHaveBeenCalledTimes(1);
});

it('ignores a result from the old dictation after its input is unmounted', async () => {
  const insert = jest.fn();
  const { result, unmount } = renderHook(() => useDictation(() => insert));
  await act(async () => result.current.start());
  const socket = TestSocket.last!;
  act(() => socket.emit({ action: 'started', code: '0' }));
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
  act(() => {
    void result.current.start();
  });
  expect(result.current.status).toBe('voice.dictationLoadingConfig');
  expect(mockGetUserMedia).not.toHaveBeenCalled();
  await act(async () => resolveConfig(config));
  expect(result.current.status).toBe('voice.microphoneWaiting');
  act(() => result.current.cancel());
  await act(async () => grantPermission({ getTracks: () => [{ stop: mockStopTrack }] }));
  expect(mockStopTrack).toHaveBeenCalledTimes(1);
  await act(async () => result.current.start());
  expect(mockGetConfig).toHaveBeenCalledTimes(2);
  expect(result.current.status).toBe('voice.dictationConnecting');
});

it.each([
  ['raw provider detail', /鉴权.*10105/],
  ['illegal access|no appid info', /未找到该应用.*10105/],
  ['illegal access|illegal client_ip: 192.0.2.1', /IP 未通过.*10105/],
])('reports provider authorization details without exposing the raw response', async (desc, hint) => {
  const error = jest.spyOn(message, 'error').mockImplementation(jest.fn());
  try {
    const { result } = renderHook(() => useDictation());
    await act(async () => result.current.start());
    act(() => TestSocket.last!.emit({ action: 'error', code: '10105', desc }));
    expect(error).toHaveBeenCalledWith(expect.stringMatching(hint));
    expect(error).not.toHaveBeenCalledWith(expect.stringContaining(desc));
  } finally {
    error.mockRestore();
  }
});

it.each([
  [undefined, /尚未配置讯飞转写/],
  ['{broken', /讯飞转写配置有误/],
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
    expect(error).toHaveBeenCalledWith(expect.stringContaining('等待讯飞连接确认超时'));
  } finally {
    error.mockRestore();
  }
});
