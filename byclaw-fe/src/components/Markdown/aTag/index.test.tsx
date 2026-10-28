import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import ATag from './index';
import { downloadFile } from '@/utils/file';
import { GET, POST } from '@/service/common/request';
import { message } from 'antd';

const mockEmit = jest.fn();

jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => id,
  }),
}));

jest.mock('@/hooks/useGlobal', () => () => ({
  EventEmitter: {
    emit: mockEmit,
  },
}));

jest.mock('@/components/MessageList/components/FileRender/components/IconRender', () => () => (
  <span data-testid="file-icon" />
));

jest.mock('@/components/MessageList/components/FileRender', () => ({
  PREVIEWABLE: ['xlsx', 'txt', 'html'],
}));

jest.mock('@/service/common/request', () => ({ GET: jest.fn(), POST: jest.fn() }));
jest.mock('antd', () => ({ message: { warning: jest.fn() } }));

jest.mock('@/components/MessageList/components/FileRender/components/Previewer/index.module.less', () => ({
  preview: 'preview-content',
}));

jest.mock('@/utils/file', () => ({
  downloadFile: jest.fn(),
  getFileUrl: (fileUrl: string) => fileUrl,
}));

describe('Markdown ATag file actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        blob: () => Promise.resolve(new Blob(['excel content'])),
      })
    ) as jest.Mock;
  });

  it('keeps preview clicks isolated from download and outer click handlers', async () => {
    const outerClick = jest.fn();

    render(
      <div onClick={outerClick}>
        <ATag
          domNode={{
            name: 'a',
            attribs: { href: '/files/report.xlsx' },
            children: [{ data: 'report.xlsx' }],
          }}
        />
      </div>
    );

    fireEvent.click(document.querySelector('.preview') as HTMLElement);

    expect(outerClick).not.toHaveBeenCalled();
    expect(downloadFile).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith('/files/report.xlsx', { cache: 'no-store' });

    await waitFor(() => {
      expect(mockEmit).toHaveBeenCalledWith(
        'beyond-main-driver-message',
        expect.objectContaining({
          type: 'xlsx',
          title: 'report.xlsx',
          data: expect.any(Blob),
        })
      );
    });
  });

  it('hides the managed summary caption because the message footer renders its voice bubble', () => {
    const { container } = render(
      <ATag
        domNode={{
          name: 'a',
          attribs: { href: '/by/.sessions/101/tts/summary.mp3' },
          children: [{ type: 'text', data: '🔊 播放语音摘要' }],
        }}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('leaves managed session file links to the message artifact renderer', () => {
    render(
      <ATag
        domNode={{
          name: 'a',
          attribs: { href: '/by/.sessions/101/output/report.xlsx' },
          children: [{ type: 'text', data: 'report.xlsx' }],
        }}
      />
    );

    expect(screen.getByText('report.xlsx')).toBeInTheDocument();
    expect(screen.queryByTestId('file-icon')).not.toBeInTheDocument();
  });

  it('does not preview or cache an HTTP error body and allows a fresh retry', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({ ok: false, statusText: 'Internal Server Error', blob: jest.fn() });
    render(<ATag domNode={{ attribs: { href: '/files/retry.txt' }, children: [{ data: 'retry.txt' }] }} />);
    fireEvent.click(document.querySelector('.preview')!);
    await waitFor(() => expect(message.warning).toHaveBeenCalledWith('fileRender.previewUnavailable'));
    expect(mockEmit).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector('.preview')!);
    await waitFor(() => expect(mockEmit).toHaveBeenCalledWith('beyond-main-driver-message', expect.any(Object)));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects empty previews', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({ ok: true, blob: async () => new Blob([]) });
    render(<ATag domNode={{ attribs: { href: '/files/empty.txt' }, children: [{ data: 'empty.txt' }] }} />);
    fireEvent.click(document.querySelector('.preview')!);
    await waitFor(() => expect(message.warning).toHaveBeenCalled());
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it('loads the latest content when a generated file is overwritten between previews', async () => {
    const old = new Blob(['old']);
    const latest = new Blob(['latest']);
    (fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, blob: async () => old })
      .mockResolvedValueOnce({ ok: true, blob: async () => latest });
    render(<ATag domNode={{ attribs: { href: '/files/changing.txt' }, children: [{ data: 'changing.txt' }] }} />);
    fireEvent.click(document.querySelector('.preview')!);
    await waitFor(() =>
      expect(mockEmit).toHaveBeenCalledWith('beyond-main-driver-message', expect.objectContaining({ data: old }))
    );
    fireEvent.click(document.querySelector('.preview')!);
    await waitFor(() =>
      expect(mockEmit).toHaveBeenLastCalledWith('beyond-main-driver-message', expect.objectContaining({ data: latest }))
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(['preview', 'download'])('loads a relative Chinese file through session APIs for %s', async (action) => {
    const path = '/.sessions/101/故地重游-高考作文.txt';
    const file = new Blob(['作文']);
    (POST as jest.Mock).mockResolvedValueOnce([{ sourcePath: path, path, fileName: '故地重游-高考作文.txt' }]);
    (GET as jest.Mock).mockResolvedValueOnce({ fileName: '故地重游-高考作文.txt', file });
    render(
      <ATag
        sessionId="101"
        messageId="answer-1"
        domNode={{
          attribs: { href: '故地重游-高考作文.txt' },
          children: [{ data: '故地重游-高考作文.txt' }],
        }}
      />
    );
    fireEvent.click(document.querySelector(`.${action}`)!);
    await waitFor(() => expect(GET).toHaveBeenCalled());
    expect(POST).toHaveBeenCalledWith('/byaiService/chat/file-artifacts/resolve', {
      sessionId: '101',
      messageId: 'answer-1',
      paths: [path],
    });
    expect(GET).toHaveBeenCalledWith(
      '/byaiService/chat/file-artifacts/download',
      { sessionId: '101', path },
      {
        responseType: 'blob',
      }
    );
    expect(fetch).not.toHaveBeenCalled();
    const actionSpy = action === 'preview' ? mockEmit : downloadFile;
    const previewArgs = ['beyond-main-driver-message', expect.objectContaining({ data: file })];
    const expectedArgs = action === 'preview' ? previewArgs : [{ file, fileName: '故地重游-高考作文.txt' }];
    await waitFor(() => expect(actionSpy).toHaveBeenCalledWith(...expectedArgs));
  });

  it('shows a warning for a nonexistent relative file without requesting a backend filename URL', async () => {
    (POST as jest.Mock).mockResolvedValueOnce([]);
    render(
      <ATag sessionId="101" domNode={{ attribs: { href: 'missing.txt' }, children: [{ data: 'missing.txt' }] }} />
    );
    fireEvent.click(document.querySelector('.preview')!);
    await waitFor(() => expect(message.warning).toHaveBeenCalled());
    expect(fetch).not.toHaveBeenCalled();
    expect(GET).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it('does not guess a session for relative links without message context', async () => {
    render(<ATag domNode={{ attribs: { href: 'no-session.txt' }, children: [{ data: 'no-session.txt' }] }} />);
    fireEvent.click(document.querySelector('.preview')!);
    await waitFor(() => expect(message.warning).toHaveBeenCalled());
    expect(POST).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('leaves a wrapped session preview URL to the authenticated artifact renderer', () => {
    render(
      <ATag
        domNode={{
          attribs: { href: '/byaiService/commonFile/preview?filePath=%2Fby%2F.sessions%2F101%2Freport.html' },
          children: [{ type: 'text', data: 'report.html' }],
        }}
      />
    );
    expect(screen.queryByTestId('file-icon')).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});
