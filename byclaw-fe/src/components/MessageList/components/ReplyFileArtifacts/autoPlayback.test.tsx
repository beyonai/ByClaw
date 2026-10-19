import { act, fireEvent, render, waitFor } from '@testing-library/react';
import ReplyFileArtifacts from './index';
import VoiceMessage from '../VoiceMessage';
import { resolveChatFileArtifacts, downloadChatFileArtifact } from '@/service/chatFileArtifact';
import { loadVoiceAudio } from '@/service/voice';
import { IMessageState } from '@/constants/message';
import type { IMessage } from '@/typescript/message';

jest.mock('@/service/chatFileArtifact', () => ({
  resolveChatFileArtifacts: jest.fn(),
  downloadChatFileArtifact: jest.fn(),
}));
jest.mock('@/service/voice', () => ({ transcribeVoice: jest.fn(), loadVoiceAudio: jest.fn() }));
const path = '/by/.sessions/auto/tts/voice.mp3';
const artifact = { path, sourcePath: path, fileName: 'voice.mp3', contentType: 'audio/mpeg' };
const message = (id: string, state = IMessageState.Done, isHistoryMsg = false) =>
  ({
    msgId: id,
    messageId: id,
    sessionId: 'auto',
    fromBeyond: true,
    messageState: state,
    isHistoryMsg,
    text: path,
  } as IMessage);
let play: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  URL.createObjectURL = jest.fn(() => 'blob:auto');
  URL.revokeObjectURL = jest.fn();
  (resolveChatFileArtifacts as jest.Mock).mockResolvedValue([artifact]);
  (downloadChatFileArtifact as jest.Mock).mockResolvedValue({ file: new Blob(['mp3']) });
  (loadVoiceAudio as jest.Mock).mockResolvedValue(new Blob(['mp3']));
  play = jest.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
  jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test.each([true, false])('mounting a completed historical/cached reply is silent (history=%s)', async (history) => {
  const view = render(
    <ReplyFileArtifacts message={message(`old-${history}`, IMessageState.Done, history)} userId="u" autoPlay />
  );
  await waitFor(() => expect(view.container.querySelectorAll('audio')).toHaveLength(1));
  await act(async () => {});
  expect(play).not.toHaveBeenCalled();
});

test('only a reply completed while mounted automatically plays', async () => {
  const view = render(<ReplyFileArtifacts message={message('live', IMessageState.Answer)} userId="u" autoPlay />);
  view.rerender(<ReplyFileArtifacts message={message('live')} userId="u" autoPlay />);
  await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
});

test('manual playback cancels automatic speech whose artifact resolver has not returned yet', async () => {
  let resolve!: (value: unknown) => void;
  (resolveChatFileArtifacts as jest.Mock).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const content = (state: IMessageState) => (
    <>
      <VoiceMessage voice={{ fileId: 'manual', fileName: 'manual.mp3', durationMs: 1000, mimeType: 'audio/mpeg' }} />
      <ReplyFileArtifacts message={message('late', state)} userId="u" autoPlay />
    </>
  );
  const view = render(content(IMessageState.Answer));
  view.rerender(content(IMessageState.Done));
  await waitFor(() => expect(resolve).toBeDefined());
  fireEvent.click(view.getByRole('button', { name: '播放语音，1秒' }));
  await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
  await act(async () => resolve([artifact]));
  await waitFor(() => expect(view.container.querySelectorAll('audio')).toHaveLength(2));
  await act(async () => {});
  expect(play).toHaveBeenCalledTimes(1);
});
