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
});
