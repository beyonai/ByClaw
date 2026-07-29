import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';

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
  PREVIEWABLE: ['xlsx'],
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
    expect(fetch).toHaveBeenCalledWith('/files/report.xlsx');

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
});
