import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import ReplyFileArtifacts from './index';
import ATag from '@/components/Markdown/aTag';
import { replaceFilePrefixInMarkdown } from '@/components/Markdown/utils';
import { downloadChatFileArtifact, resolveChatFileArtifacts } from '@/service/chatFileArtifact';
import { IMessageState } from '@/constants/message';
import type { IMessage } from '@/typescript/message';

jest.mock('@/service/chatFileArtifact', () => ({
  downloadChatFileArtifact: jest.fn(),
  resolveChatFileArtifacts: jest.fn(),
}));

jest.mock('@/components/MessageList/components/FileRender', () => ({
  __esModule: true,
  PREVIEWABLE: ['html'],
  default: ({ fileItem }: any) => (
    <button type="button" onClick={() => fileItem.downloadRequest?.()}>
      {fileItem.queryFile?.fileName}
    </button>
  ),
}));

jest.mock('@umijs/max', () => ({ useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }) }));
jest.mock('@/hooks/useGlobal', () => () => ({ EventEmitter: { emit: jest.fn() } }));
jest.mock('@/utils/file', () => ({ getFileUrl: (url: string) => url, downloadFile: jest.fn() }));
jest.mock('@/components/MessageList/components/FileRender/components/IconRender', () => () => (
  <span data-testid="inline-file-icon" />
));

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
      paths: ['/.sessions/101/output/report.pptx'],
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

  it.each([
    '/by/.sessions/101/output/report.pptx',
    '/byaiService/commonFile/preview?filePath=%2F.sessions%2F101%2Foutput%2Freport.pptx',
    '/byaiService/chat/file-artifacts/download?sessionId=101&path=%2Fby%2F.sessions%2F101%2Foutput%2Freport.pptx',
  ])('deduplicates an existing attachment by its canonical path: %s', async (filePath) => {
    render(
      <ReplyFileArtifacts
        message={message({
          messageId: `path-${filePath}`,
          fileList: [
            { uid: 'existing', status: 'done', fileType: 'file', queryFile: { fileName: 'renamed.pptx', filePath } },
          ],
        })}
      />
    );
    await waitFor(() => expect(mockResolve).toHaveBeenCalled());
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('keeps files with the same name at different paths', async () => {
    render(
      <ReplyFileArtifacts
        message={message({
          messageId: 'same-name-different-path',
          fileList: [
            {
              uid: 'other',
              status: 'done',
              fileType: 'file',
              queryFile: { fileName: 'report.pptx', filePath: '/.sessions/101/other/report.pptx' },
            },
          ],
        })}
      />
    );
    expect(await screen.findByRole('button', { name: 'report.pptx' })).toBeInTheDocument();
  });

  it('deduplicates resolver results after canonicalizing paths', async () => {
    const path = '/.sessions/101/output/report.pptx';
    mockResolve.mockResolvedValueOnce([
      { sourcePath: path, path, fileName: 'report.pptx' },
      { sourcePath: `/by${path}`, path: `/by${path}`, fileName: 'report.pptx' },
    ]);
    render(<ReplyFileArtifacts message={message({ messageId: 'resolver-aliases' })} />);
    expect(await screen.findAllByRole('button', { name: 'report.pptx' })).toHaveLength(1);
  });

  it('renders one card for repeated Markdown links and the resolved file artifact', async () => {
    const path = '/.sessions/101/report.html';
    const link = `[report.html]({{file_preview_prefix}}/by${path})`;
    const answer = `已完成转换。${link}\n已完成转换。${link}`;
    const rewritten = replaceFilePrefixInMarkdown(
      answer,
      (url, regExp) => `/byaiService/commonFile/preview?filePath=${url.replace(regExp, '')}`
    );
    const href = rewritten.match(/\]\(([^)]*)\)/)?.[1];
    const node = { name: 'a', attribs: { href }, children: [{ type: 'text', data: 'report.html' }] };
    mockResolve.mockResolvedValueOnce([{ sourcePath: path, path, fileName: 'report.html', fileSize: 100 }]);
    render(
      <>
        <ATag domNode={node} />
        <ATag domNode={node} />
        <ReplyFileArtifacts message={message({ messageId: 'markdown-and-artifact', text: answer })} />
      </>
    );
    expect(await screen.findAllByRole('button', { name: 'report.html' })).toHaveLength(1);
    expect(screen.queryByTestId('inline-file-icon')).not.toBeInTheDocument();
    expect(mockResolve).toHaveBeenCalledWith(expect.objectContaining({ paths: [path] }));
  });
});
