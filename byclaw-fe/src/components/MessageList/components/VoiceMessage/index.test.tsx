import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { loadVoiceAudio, transcribeVoice } from '@/service/voice';
import VoiceMessage from './index';

jest.mock('@/service/voice', () => ({ loadVoiceAudio: jest.fn(), transcribeVoice: jest.fn() }));
const voice = { fileId: '123', fileName: 'voice.mp3', durationMs: 3200, mimeType: 'audio/mpeg' };

describe('VoiceMessage', () => {
  let play: jest.SpyInstance;
  let pause: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    URL.createObjectURL = jest.fn(() => 'blob:voice');
    URL.revokeObjectURL = jest.fn();
    play = jest.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
      Object.defineProperty(this, 'paused', { configurable: true, value: false });
      this.dispatchEvent(new Event('play'));
      return Promise.resolve();
    });
    pause = jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
      Object.defineProperty(this, 'paused', { configurable: true, value: true });
      this.dispatchEvent(new Event('pause'));
    });
    (loadVoiceAudio as jest.Mock).mockResolvedValue(new Blob(['mp3'], { type: 'audio/mpeg' }));
    (transcribeVoice as jest.Mock).mockResolvedValue({ text: '这是一条语音消息' });
  });

  afterEach(() => {
    play.mockRestore();
    pause.mockRestore();
  });

  it('shows seconds and transcribes only when requested', async () => {
    const onTranscript = jest.fn();
    render(<VoiceMessage voice={voice} sessionId="99" onTranscript={onTranscript} />);
    expect(screen.getByRole('button', { name: '播放语音，4秒' })).toHaveTextContent('4″');
    expect(transcribeVoice).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '语音消息菜单' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '语音转文字' }));
    await screen.findByText('这是一条语音消息');
    expect(transcribeVoice).toHaveBeenCalledWith({ fileId: '123', sessionId: '99' });
    expect(onTranscript).toHaveBeenCalledWith('这是一条语音消息');
  });

  it('collapses and reopens cached transcription without another ASR call', async () => {
    render(<VoiceMessage voice={voice} />);
    const menuButton = screen.getByRole('button', { name: '语音消息菜单' });
    fireEvent.click(menuButton);
    fireEvent.click(await screen.findByRole('menuitem', { name: '语音转文字' }));
    await screen.findByText('这是一条语音消息');
    fireEvent.click(menuButton);
    fireEvent.click(await screen.findByRole('menuitem', { name: '收起文字' }));
    expect(screen.queryByText('这是一条语音消息')).not.toBeInTheDocument();
    fireEvent.click(menuButton);
    fireEvent.click(await screen.findByRole('menuitem', { name: '语音转文字' }));
    expect(screen.getByText('这是一条语音消息')).toBeInTheDocument();
    expect(transcribeVoice).toHaveBeenCalledTimes(1);
  });

  it('offers transcription through the voice bubble context menu', async () => {
    render(<VoiceMessage voice={voice} />);
    fireEvent.contextMenu(screen.getByRole('button', { name: '播放语音，4秒' }));
    expect(await screen.findByRole('menuitem', { name: '语音转文字' })).toBeInTheDocument();
    expect(play).not.toHaveBeenCalled();
  });

  it('plays authenticated audio, toggles pause and revokes the source on unmount', async () => {
    const { unmount } = render(<VoiceMessage voice={voice} />);
    fireEvent.click(screen.getByRole('button', { name: '播放语音，4秒' }));
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    expect(loadVoiceAudio).toHaveBeenCalledWith('123');
    fireEvent.click(screen.getByRole('button', { name: '暂停语音，4秒' }));
    expect(pause).toHaveBeenCalled();
    await act(async () => unmount());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:voice');
  });

  it('preloads unknown duration from real metadata and reuses its Blob for playback', async () => {
    const loadAudio = jest.fn().mockResolvedValue(new Blob(['summary'], { type: 'audio/mpeg' }));
    const transcribeAudio = jest.fn().mockResolvedValue({ text: '摘要转换结果' });
    const { container } = render(
      <VoiceMessage
        voice={{ fileName: 'summary.mp3', durationMs: 0, mimeType: 'audio/mpeg' }}
        label="语音摘要"
        variant="assistant"
        loadAudio={loadAudio}
        transcribeAudio={transcribeAudio}
      />
    );
    expect(screen.getByLabelText('正在读取语音时长')).toBeInTheDocument();
    expect(screen.queryByText('0″')).not.toBeInTheDocument();
    await waitFor(() => expect(loadAudio).toHaveBeenCalledTimes(1));
    const audio = container.querySelector('audio')!;
    await waitFor(() => expect(audio.src).toContain('blob:voice'));
    Object.defineProperty(audio, 'duration', { configurable: true, value: 7.18 });
    fireEvent.loadedMetadata(audio);
    expect(screen.getByRole('button', { name: '播放语音摘要' })).toHaveTextContent('8″');
    fireEvent.click(screen.getByRole('button', { name: '播放语音摘要' }));
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    expect(loadAudio).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '语音消息菜单' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '语音转文字' }));
    await screen.findByText('摘要转换结果');
    expect(transcribeAudio).toHaveBeenCalledTimes(1);
    expect(transcribeVoice).not.toHaveBeenCalled();
  });

  it('renders generated speech summaries without a transcription action', async () => {
    const loadAudio = jest.fn().mockResolvedValue(new Blob(['summary']));
    render(<VoiceMessage voice={voice} label="语音摘要" loadAudio={loadAudio} showTranscribe={false} />);
    expect(screen.queryByRole('button', { name: '语音消息菜单' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '播放语音摘要' }));
    await waitFor(() => expect(loadAudio).toHaveBeenCalledTimes(1));
    expect(loadVoiceAudio).not.toHaveBeenCalled();
  });
  it('automatically transcribes a new user voice once and retains manual retry on failure', async () => {
    (transcribeVoice as jest.Mock).mockRejectedValueOnce(new Error('temporary'));
    const view = render(<VoiceMessage voice={voice} autoTranscribe />);
    await waitFor(() => expect(transcribeVoice).toHaveBeenCalledTimes(1));
    view.rerender(<VoiceMessage voice={{ ...voice }} autoTranscribe />);
    fireEvent.click(screen.getByRole('button', { name: '语音消息菜单' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '语音转文字' }));
    expect(await screen.findByText('这是一条语音消息')).toBeInTheDocument();
    expect(transcribeVoice).toHaveBeenCalledTimes(2);
  });

  it('uses an existing transcript without automatically calling ASR', async () => {
    render(<VoiceMessage voice={{ ...voice, transcript: '已有文字' }} autoTranscribe />);
    expect(screen.getByText('已有文字')).toBeInTheDocument();
    await act(async () => {});
    expect(transcribeVoice).not.toHaveBeenCalled();
  });

  it('plays realtime segments sequentially and never replays them on remount', async () => {
    const bubbles = () => (
      <>
        {[1, 2, 3].map((n) => (
          <VoiceMessage key={n} voice={{ ...voice, fileId: String(n) }} autoPlayKey={`sequence:${n}`} autoPlay />
        ))}
      </>
    );
    const view = render(bubbles());
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    const audios = view.container.querySelectorAll('audio');
    expect(play.mock.instances[0]).toBe(audios[0]);
    fireEvent.ended(audios[0]);
    await waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    expect(play.mock.instances[1]).toBe(audios[1]);
    fireEvent.ended(audios[1]);
    await waitFor(() => expect(play).toHaveBeenCalledTimes(3));
    expect(play.mock.instances[2]).toBe(audios[2]);
    fireEvent.ended(audios[2]);
    view.unmount();
    render(bubbles());
    await act(async () => {});
    expect(play).toHaveBeenCalledTimes(3);
  });

  it('does not catch up old speech when auto playback is enabled later', async () => {
    const view = render(<VoiceMessage voice={voice} autoPlayKey="disabled-first" autoPlay={false} />);
    view.rerender(<VoiceMessage voice={voice} autoPlayKey="disabled-first" autoPlay />);
    await act(async () => {});
    expect(play).not.toHaveBeenCalled();
  });

  it('cancels pending playback on unmount even when the download completes later', async () => {
    let resolve!: (blob: Blob) => void;
    const loadAudio = () =>
      new Promise<Blob>((done) => {
        resolve = done;
      });
    const view = render(<VoiceMessage voice={voice} loadAudio={loadAudio} autoPlayKey="unmounted" autoPlay />);
    await waitFor(() => expect(resolve).toBeDefined());
    view.unmount();
    await act(async () => resolve(new Blob(['mp3'])));
    expect(play).not.toHaveBeenCalled();
  });
  it('drops queued segments when leaving during playback and returning', async () => {
    const bubbles = () => (
      <>
        {[1, 2].map((n) => (
          <VoiceMessage key={n} voice={voice} autoPlayKey={`leave:${n}`} autoPlay />
        ))}
      </>
    );
    const view = render(bubbles());
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => {});
    render(bubbles());
    await act(async () => {});
    expect(play).toHaveBeenCalledTimes(1);
  });
  it('keeps one ordered playback registration through StrictMode effect replay', async () => {
    const view = render(
      <StrictMode>
        <VoiceMessage voice={voice} autoPlayKey="strict" autoPlay />
      </StrictMode>
    );
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    fireEvent.ended(view.container.querySelector('audio')!);
    await act(async () => {});
    expect(play).toHaveBeenCalledTimes(1);
  });
});
