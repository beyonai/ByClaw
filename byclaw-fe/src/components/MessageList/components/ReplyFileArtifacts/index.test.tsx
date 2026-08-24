import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import ReplyFileArtifacts from './index';
import { downloadChatFileArtifact, resolveChatFileArtifacts } from '@/service/chatFileArtifact';
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
