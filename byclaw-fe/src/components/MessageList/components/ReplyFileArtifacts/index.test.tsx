import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import ReplyFileArtifacts from './index';
import { downloadChatFileArtifact, resolveChatFileArtifacts } from '@/service/chatFileArtifact';
import { transcribeVoice } from '@/service/voice';
import { IMessageState } from '@/constants/message';
import type { IMessage } from '@/typescript/message';

jest.mock('@/service/chatFileArtifact', () => ({
  downloadChatFileArtifact: jest.fn(),
  resolveChatFileArtifacts: jest.fn(),
}));

jest.mock('@/components/MessageList/components/FileRender', () => ({
  __esModule: true,
  default: ({ fileItem }: any) => (
    <button type="button" onClick={() => fileItem.downloadRequest?.()}>
      {fileItem.queryFile?.fileName}
    </button>
  ),
}));

const mockVoiceProps = jest.fn();
jest.mock('@/service/voice', () => ({ transcribeVoice: jest.fn().mockResolvedValue({ text: '摘要文字' }) }));

jest.mock('../VoiceMessage', () => ({
  __esModule: true,
  default: (props: any) => {
    mockVoiceProps(props);
    return (
      <button type="button" onClick={() => props.loadAudio?.()}>
        播放{props.label}
      </button>
    );
  },
}));

const mockResolve = resolveChatFileArtifacts as jest.MockedFunction<typeof resolveChatFileArtifacts>;
const mockDownload = downloadChatFileArtifact as jest.MockedFunction<typeof downloadChatFileArtifact>;

const message = (overrides: Partial<IMessage> = {}): IMessage => ({
  creatorId: 'agent-1',
  fromBeyond: true,
  text: '文件路径：/by/.sessions/101/output/report.pptx',
  msgId: 'm1',
  messageId: 'm1',
  sessionId: '101',
  messageState: IMessageState.Done,
  createTime: '1',
  ...overrides,
});

describe('ReplyFileArtifacts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolve.mockResolvedValue([
      {
        sourcePath: '/.sessions/101/output/report.pptx',
        path: '/.sessions/101/output/report.pptx',
        fileName: 'report.pptx',
        fileSize: 100,
        contentType: 'application/pptx',
      },
    ]);
    mockDownload.mockResolvedValue({ fileName: 'report.pptx', file: new Blob(['pptx']) });
  });

  it('resolves completed assistant reply and renders a downloadable file', async () => {
    render(<ReplyFileArtifacts message={message()} />);

    expect(await screen.findByRole('button', { name: 'report.pptx' })).toBeInTheDocument();
    expect(mockResolve).toHaveBeenCalledWith({
      sessionId: '101',
      messageId: 'm1',
      paths: ['/by/.sessions/101/output/report.pptx'],
    });

    fireEvent.click(screen.getByRole('button', { name: 'report.pptx' }));
    expect(mockDownload).toHaveBeenCalledWith({
      sessionId: '101',
      path: '/.sessions/101/output/report.pptx',
    });
  });

  it('renders a generated MP3 from finalContent as an authenticated speech summary', async () => {
    mockResolve.mockResolvedValueOnce([
      {
        sourcePath: '/by/.sessions/101/tts/summary.mp3',
        path: '/.sessions/101/tts/summary.mp3',
        fileName: 'summary.mp3',
        fileSize: 1024,
        contentType: 'audio/mpeg',
      },
    ]);
    render(
      <ReplyFileArtifacts
        message={message({
          msgId: 'm-speech',
          messageId: 'm-speech',
          text: '',
          finalContent: '[播放语音摘要](/by/.sessions/101/tts/summary.mp3)',
        })}
      />
    );
    fireEvent.click(await screen.findByRole('button', { name: '播放语音摘要' }));
    expect(mockResolve).toHaveBeenCalledWith({
      sessionId: '101',
      messageId: 'm-speech',
      paths: ['/by/.sessions/101/tts/summary.mp3'],
    });
    expect(mockDownload).toHaveBeenCalledWith({ sessionId: '101', path: '/.sessions/101/tts/summary.mp3' });
  });

  it('normalizes executor image paths alongside summary audio before resolving the batch', async () => {
    mockResolve.mockResolvedValueOnce([
      {
        sourcePath: '/by/.sessions/101/tts/summary.mp3',
        path: '/.sessions/101/tts/summary.mp3',
        fileName: 'summary.mp3',
        fileSize: 1024,
        contentType: 'audio/mpeg',
      },
    ]);
    render(
      <ReplyFileArtifacts
        message={message({
          msgId: 'm-host-output',
          messageId: 'm-host-output',
          text: '',
          finalContent:
            '`/temporary/storage/byclaw-user/by/.sessions/101/image/result.jpg`\n[🔊 播放语音摘要](/by/.sessions/101/tts/summary.mp3)',
        })}
      />
    );
    expect(await screen.findByRole('button', { name: '播放语音摘要' })).toBeInTheDocument();
    expect(mockResolve).toHaveBeenCalledWith({
      sessionId: '101',
      messageId: 'm-host-output',
      paths: ['/by/.sessions/101/image/result.jpg', '/by/.sessions/101/tts/summary.mp3'],
    });
  });

  it('puts speech after file cards and transcribes its owned artifact path', async () => {
    mockResolve.mockResolvedValueOnce([
      {
        sourcePath: '/by/.sessions/101/image/result.jpg',
        path: '/.sessions/101/image/result.jpg',
        fileName: 'result.jpg',
        fileSize: 100,
        contentType: 'image/jpeg',
      },
      {
        sourcePath: '/by/.sessions/101/tts/summary.mp3',
        path: '/.sessions/101/tts/summary.mp3',
        fileName: 'summary.mp3',
        fileSize: 1024,
        contentType: 'audio/mpeg',
      },
    ]);
    render(
      <ReplyFileArtifacts
        message={message({
          msgId: 'm-footer',
          messageId: 'm-footer',
          text: '',
          finalContent:
            '[图片](/by/.sessions/101/image/result.jpg)\n[🔊 播放语音摘要](/by/.sessions/101/tts/summary.mp3)',
        })}
      />
    );
    await screen.findByRole('button', { name: '播放语音摘要' });
    const files = screen.getByTestId('reply-artifact-files');
    const footer = screen.getByTestId('speech-summary-footer');
    expect(files.nextSibling).toBe(footer);
    expect(files).not.toContainElement(screen.getByRole('button', { name: '播放语音摘要' }));
    const props = mockVoiceProps.mock.calls[mockVoiceProps.mock.calls.length - 1][0];
    expect(props.voice).not.toHaveProperty('fileId');
    await props.transcribeAudio();
    expect(transcribeVoice).toHaveBeenCalledWith({ sessionId: '101', path: '/.sessions/101/tts/summary.mp3' });
  });

  it('does not resolve while the answer is still streaming', async () => {
    render(
      <ReplyFileArtifacts message={message({ msgId: 'm2', messageId: 'm2', messageState: IMessageState.Answer })} />
    );

    await waitFor(() => expect(mockResolve).not.toHaveBeenCalled());
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('does not duplicate an existing message attachment', async () => {
    render(
      <ReplyFileArtifacts
        message={message({
          msgId: 'm3',
          messageId: 'm3',
          fileList: [
            {
              uid: 'existing',
              status: 'done',
              fileType: 'file',
              queryFile: { fileName: 'report.pptx' },
            },
          ],
        })}
      />
    );

    await waitFor(() => expect(mockResolve).toHaveBeenCalled());
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
