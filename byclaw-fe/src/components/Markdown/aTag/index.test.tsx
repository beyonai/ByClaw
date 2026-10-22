import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import ATag from './index';
import { downloadFile } from '@/utils/file';

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
  PREVIEWABLE: ['xlsx', 'html'],
}));

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

  it.each([
    '/byaiService/commonFile/preview?filePath=%2Fby%2F.sessions%2F101%2Freport.html',
    '/commonFile/preview?filePath=/.sessions/101/report.html',
    `${window.location.origin}/byaiService/commonFile/preview?filePath=%2F.sessions%2F101%2Freport.html`,
  ])('leaves rewritten managed preview links to the message artifact renderer: %s', (href) => {
    render(<ATag domNode={{ name: 'a', attribs: { href }, children: [{ type: 'text', data: 'report.html' }] }} />);
    expect(screen.getByText('report.html')).toBeInTheDocument();
    expect(screen.queryByTestId('file-icon')).not.toBeInTheDocument();
  });

  it.each([
    'https://example.com/byaiService/commonFile/preview?filePath=%2F.sessions%2F101%2Freport.html',
    '/byaiService/commonFile/preview?bucketName=other-user&filePath=%2F.sessions%2F101%2Freport.html',
  ])('keeps remote and explicit-bucket download links available: %s', (href) => {
    render(<ATag domNode={{ name: 'a', attribs: { href }, children: [{ type: 'text', data: 'report.html' }] }} />);
    expect(screen.getByTestId('file-icon')).toBeInTheDocument();
  });
});
