import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReplyFileArtifacts from './index';
import { resolveChatFileArtifacts, downloadChatFileArtifact } from '@/service/chatFileArtifact';
import { transcribeVoice } from '@/service/voice';
import { IMessageState } from '@/constants/message';
import type { IMessage } from '@/typescript/message';

jest.mock('@umijs/max', () => ({ useIntl: () => require('@/testUtils/localeIntl').getLocaleIntl() }));

jest.mock('@/service/chatFileArtifact', () => ({
  resolveChatFileArtifacts: jest.fn(),
  downloadChatFileArtifact: jest.fn(),
}));
jest.mock('@/service/voice', () => ({ transcribeVoice: jest.fn(), loadVoiceAudio: jest.fn() }));

test('four structured speech results render four real voice bubbles with distinct owned audio sources', async () => {
  const paths = ['vivi', 'xiaohe', 'yunzhou', 'xiaotian'].map((name) => `/by/.sessions/100/tts/${name}.mp3`);
  (resolveChatFileArtifacts as jest.Mock).mockResolvedValue(
    paths.map((path) => ({ path, sourcePath: path, fileName: path.split('/').pop(), contentType: 'audio/mpeg' }))
  );
  (downloadChatFileArtifact as jest.Mock).mockResolvedValue({ file: new Blob(['ID3'], { type: 'audio/mpeg' }) });
  (transcribeVoice as jest.Mock).mockResolvedValue({ text: '这是第一段语音' });
  URL.createObjectURL = jest.fn(() => 'blob:speech-test');
  URL.revokeObjectURL = jest.fn();
  jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  const message = {
    fromBeyond: true,
    messageState: IMessageState.Done,
    sessionId: '100',
    messageId: 'four-speech-results',
    text: '4 段音色汇报已全部就绪：vivi.mp3、xiaohe.mp3、yunzhou.mp3、xiaotian.mp3',
    thinkList: paths.map((path) => ({
      content: {
        substance: JSON.stringify({ output: JSON.stringify({ artifacts: [{ path, mimeType: 'audio/mpeg' }] }) }),
      },
    })),
  } as unknown as IMessage;
  const view = render(<ReplyFileArtifacts message={message} />);
  expect(await screen.findAllByRole('button', { name: '播放语音摘要' })).toHaveLength(4);
  await waitFor(() => expect(downloadChatFileArtifact).toHaveBeenCalledTimes(4));
  paths.forEach((path) => expect(downloadChatFileArtifact).toHaveBeenCalledWith({ sessionId: '100', path }));
  expect(view.container.querySelectorAll('audio')).toHaveLength(4);
  fireEvent.click(screen.getAllByRole('button', { name: '语音消息菜单' })[0]);
  fireEvent.click(await screen.findByText('语音转文字'));
  expect(await screen.findByText('这是第一段语音')).toBeInTheDocument();
  expect(transcribeVoice).toHaveBeenCalledWith({ sessionId: '100', path: paths[0] });
  view.unmount();
  jest.restoreAllMocks();
});
