import { act, fireEvent, render, screen } from '@testing-library/react';
import VoiceRecorder from './index';

const mockRecorder = { open: jest.fn(), start: jest.fn(), stop: jest.fn(), close: jest.fn() };
const mockGetUserMedia = jest.fn();
const mockStartDictation = jest.fn();
const mockStopDictation = jest.fn();
const mockCloseDictation = jest.fn();
let mockDictationActive = false;
let mockDictationStatus = 'voice.dictating';
const mockStopTrack = jest.fn();

jest.mock('recorder-core', () => ({ __esModule: true, default: jest.fn(() => mockRecorder) }));
jest.mock('recorder-core/src/engine/mp3', () => ({}));
jest.mock('recorder-core/src/engine/mp3-engine', () => ({}));
jest.mock('@/components/AntdIcon', () => () => <span />);
jest.mock('./useDictation', () => ({
  __esModule: true,
  default: () => ({
    active: mockDictationActive,
    status: mockDictationStatus,
    level: 0,
    start: mockStartDictation,
    stop: mockStopDictation,
    cancel: jest.fn(),
    close: mockCloseDictation,
  }),
}));
jest.mock('@umijs/max', () => ({
  useIntl: () => require('@/testUtils/localeIntl').getLocaleIntl('zh-CN'),
}));

const mic = () => screen.getByRole('button', { name: '单击转文字，长按发语音' });
const pointer = (type: string, clientY = 200, clientX = 200) => {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientY, clientX });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  fireEvent(mic(), event);
};
const stream = () => ({ getTracks: () => [{ stop: mockStopTrack, addEventListener: jest.fn() }] });
const hold = async () => {
  pointer('pointerdown');
  await act(async () => jest.advanceTimersByTime(350));
};

beforeEach(() => {
  mockDictationActive = false;
  mockDictationStatus = 'voice.dictating';
  jest.useFakeTimers();
  jest.clearAllMocks();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: mockGetUserMedia } });
  mockGetUserMedia.mockResolvedValue(stream());
  mockRecorder.open.mockImplementation((opened) => opened());
  mockRecorder.stop.mockImplementation((stopped) => stopped(new Blob(['mp3']), 3200));
});
afterEach(() => jest.useRealTimers());

it('uses a short press for dictation without opening the message recorder', () => {
  render(<VoiceRecorder onRecorded={jest.fn()} />);
  pointer('pointerdown');
  pointer('pointerup');
  fireEvent.click(mic(), { detail: 1 });
  expect(mockStartDictation).toHaveBeenCalledTimes(1);
  expect(mockRecorder.start).not.toHaveBeenCalled();
});

it('offers separate close and finish controls with a timer while dictating', () => {
  mockDictationActive = true;
  const onRecorded = jest.fn();
  render(<VoiceRecorder onRecorded={onRecorded} />);
  act(() => jest.advanceTimersByTime(1000));
  expect(screen.getByRole('timer')).toHaveTextContent('1');
  fireEvent.click(screen.getByRole('button', { name: '结束转文字' }));
  expect(mockStopDictation).toHaveBeenCalledTimes(1);
  expect(onRecorded).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '关闭转文字' }));
  expect(mockCloseDictation).toHaveBeenCalledTimes(1);
});

it.each([
  ['voice.dictationLoadingConfig', '正在读取转写配置'],
  ['voice.microphoneWaiting', '等待麦克风授权'],
])('keeps cancel available and hides the timer during %s', (status, hint) => {
  mockDictationActive = true;
  mockDictationStatus = status;
  render(<VoiceRecorder onRecorded={jest.fn()} />);
  expect(screen.getByRole('status')).toHaveTextContent(hint);
  expect(screen.queryByRole('timer')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '结束转文字' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '关闭转文字' }));
  expect(mockCloseDictation).toHaveBeenCalledTimes(1);
});

it('shows hold progress immediately and removes it when the gesture slides away before recording', () => {
  render(<VoiceRecorder onRecorded={jest.fn()} />);
  pointer('pointerdown');
  expect(mic()).toHaveAttribute('data-holding', 'true');
  pointer('pointermove', 170);
  expect(mic()).not.toHaveAttribute('data-holding');
  pointer('pointerup', 170);
  expect(mockStartDictation).not.toHaveBeenCalled();
  expect(mockGetUserMedia).not.toHaveBeenCalled();
});

it('shows the waveform in the input slot and sends an MP3 once on release', async () => {
  const onRecorded = jest.fn().mockResolvedValue(undefined);
  const panel = document.createElement('div');
  document.body.appendChild(panel);
  try {
    render(<VoiceRecorder onRecorded={onRecorded} panelContainer={() => panel} />);
    await hold();
    expect(panel).toContainElement(screen.getByRole('timer'));
    const hint = screen.getByRole('status');
    expect(panel).not.toContainElement(hint);
    expect(hint.nextElementSibling).toBe(mic());
    expect(onRecorded).not.toHaveBeenCalled();
    await act(async () => pointer('pointerup'));
    expect(onRecorded).toHaveBeenCalledTimes(1);
    expect(onRecorded.mock.calls[0][0]).toMatchObject({ type: 'audio/mpeg' });
    expect(onRecorded.mock.calls[0][1]).toBe(3200);
    expect(mockStopTrack).toHaveBeenCalledTimes(1);
    expect(mockStartDictation).not.toHaveBeenCalled();
  } finally {
    panel.remove();
  }
});

it('uses the release position to discard a recording after a left swipe', async () => {
  const onRecorded = jest.fn();
  render(<VoiceRecorder onRecorded={onRecorded} />);
  await hold();
  pointer('pointerup', 200, 100);
  expect(mockRecorder.close).toHaveBeenCalled();
  expect(onRecorded).not.toHaveBeenCalled();
});

it('restores sending after sliding right out of the cancel zone', async () => {
  const onRecorded = jest.fn().mockResolvedValue(undefined);
  render(<VoiceRecorder onRecorded={onRecorded} />);
  await hold();
  pointer('pointermove', 200, 100);
  expect(screen.getByRole('status')).toHaveTextContent('松开取消');
  pointer('pointermove', 100, 180);
  expect(screen.getByRole('status')).toHaveTextContent('左滑取消');
  await act(async () => pointer('pointerup', 100, 180));
  expect(onRecorded).toHaveBeenCalledTimes(1);
});

it('releases a late permission grant after the pointer has already been lifted', async () => {
  let allow: () => void = () => undefined;
  mockGetUserMedia.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        allow = () => resolve(stream());
      })
  );
  const onRecorded = jest.fn();
  render(<VoiceRecorder onRecorded={onRecorded} />);
  await hold();
  pointer('pointerup');
  await act(async () => allow());
  expect(mockRecorder.start).not.toHaveBeenCalled();
  expect(mockStopTrack).toHaveBeenCalledTimes(1);
  expect(onRecorded).not.toHaveBeenCalled();
});

it('retries sending the same file after an upload failure', async () => {
  const onRecorded = jest.fn().mockRejectedValueOnce(new Error()).mockResolvedValueOnce(undefined);
  render(<VoiceRecorder onRecorded={onRecorded} />);
  await hold();
  await act(async () => pointer('pointerup'));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: '重试发送' })));
  expect(onRecorded).toHaveBeenCalledTimes(2);
  expect(onRecorded.mock.calls[1][0]).toBe(onRecorded.mock.calls[0][0]);
  expect(screen.queryByRole('button', { name: '重试发送' })).not.toBeInTheDocument();
});

it('releases the microphone and discards the recording when the session component is replaced', async () => {
  const onRecorded = jest.fn();
  const { rerender } = render(<VoiceRecorder key="old" onRecorded={onRecorded} />);
  await hold();
  rerender(<VoiceRecorder key="new" onRecorded={onRecorded} />);
  expect(mockStopTrack).toHaveBeenCalledTimes(1);
  expect(onRecorded).not.toHaveBeenCalled();
});

it('stops at 60 seconds but waits for release to send', async () => {
  const onRecorded = jest.fn().mockResolvedValue(undefined);
  render(<VoiceRecorder onRecorded={onRecorded} />);
  await hold();
  await act(async () => jest.advanceTimersByTime(60000));
  expect(mockStopTrack).toHaveBeenCalledTimes(1);
  expect(onRecorded).not.toHaveBeenCalled();
  await act(async () => pointer('pointerup'));
  expect(onRecorded).toHaveBeenCalledTimes(1);
});

it('aborts a released recording that is still uploading when the session changes', async () => {
  let finish: () => void = () => undefined;
  const onRecorded = jest.fn<Promise<void>, [File, number, AbortController]>(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  const { rerender } = render(<VoiceRecorder key="old" onRecorded={onRecorded} />);
  await hold();
  await act(async () => pointer('pointerup'));
  const [, , cancelToken] = onRecorded.mock.calls[0];
  rerender(<VoiceRecorder key="new" onRecorded={onRecorded} />);
  expect(cancelToken.signal.aborted).toBe(true);
  await act(async () => finish());
  expect(screen.queryByRole('button', { name: '重试发送' })).not.toBeInTheDocument();
});
