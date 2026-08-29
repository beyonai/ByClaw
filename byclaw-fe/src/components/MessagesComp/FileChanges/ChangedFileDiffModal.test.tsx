import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { getChangedFileDiff } from '@/service/fileBrowser';

import ChangedFileDiffModal from './ChangedFileDiffModal';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));

jest.mock('@/service/fileBrowser', () => ({
  getChangedFileDiff: jest.fn(),
}));

jest.mock('@/components/ChatLayoutComp/ChatResourceWorkspace/FilePreviewPanel', () => ({
  __esModule: true,
  default: ({ fileName, content }: { fileName: string; content: { data: string } }) => (
    <div data-testid="binary-preview">{`${fileName}:${content.data}`}</div>
  ),
}));

const mockGetChangedFileDiff = getChangedFileDiff as jest.MockedFunction<typeof getChangedFileDiff>;

const baseDiff = {
  version: 1,
  uuid: 'file-1',
  sessionId: 'session-1',
  filePath: 'src/example.ts',
  workspace: '/workspace',
  absolutePath: '/workspace/src/example.ts',
  changeType: 'modified' as const,
  changed: true,
  binary: false,
  contentEncoding: 'utf-8' as const,
  originalExists: true,
  modifiedExists: true,
  originalMode: 420,
  modifiedMode: 420,
  originalSize: 12,
  modifiedSize: 12,
  originalContent: 'const old = 1;',
  modifiedContent: 'const next = 1;',
  additions: 1,
  deletions: 1,
  sources: ['Edit'],
};

describe('ChangedFileDiffModal', () => {
  beforeEach(() => jest.clearAllMocks());

  it('loads and renders a text diff', async () => {
    mockGetChangedFileDiff.mockResolvedValue(baseDiff);

    render(<ChangedFileDiffModal open sessionId="session-1" uuid="file-1" path="src/example.ts" onClose={jest.fn()} />);

    await waitFor(() => expect(mockGetChangedFileDiff).toHaveBeenCalledWith('session-1', 'file-1'));
    expect(await screen.findByText('const old = 1;')).toBeInTheDocument();
    expect(screen.getByText('const next = 1;')).toBeInTheDocument();
  });

  it('previews the available binary content without rendering a diff', async () => {
    mockGetChangedFileDiff.mockResolvedValue({
      ...baseDiff,
      binary: true,
      contentEncoding: 'base64',
      filePath: 'image.png',
      originalContent: null,
      modifiedContent: 'aW1hZ2U=',
    });

    render(<ChangedFileDiffModal open sessionId="session-1" uuid="file-1" path="image.png" onClose={jest.fn()} />);

    expect(await screen.findByTestId('binary-preview')).toHaveTextContent('image.png:aW1hZ2U=');
  });

  it('collapses distant unchanged lines and expands them on demand', async () => {
    const original = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`);
    const modified = [...original];
    modified[5] = 'changed line';
    mockGetChangedFileDiff.mockResolvedValue({
      ...baseDiff,
      originalContent: original.join('\n'),
      modifiedContent: modified.join('\n'),
    });

    render(<ChangedFileDiffModal open sessionId="session-1" uuid="file-1" path="src/example.ts" onClose={jest.fn()} />);

    expect(await screen.findByText('changed line')).toBeInTheDocument();
    expect(screen.queryByText('line 1')).not.toBeInTheDocument();
    const [expandButton] = screen.getAllByRole('button', { name: 'fileChanges.expandUnchanged' });
    fireEvent.click(expandButton);
    expect(screen.getByText('line 1')).toBeInTheDocument();
  });

  it('switches files from the title selector', async () => {
    const onFileChange = jest.fn();
    mockGetChangedFileDiff.mockResolvedValue(baseDiff);

    render(
      <ChangedFileDiffModal
        open
        sessionId="session-1"
        uuid="file-1"
        path="src/example.ts"
        files={[
          { uuid: 'file-1', path: 'src/example.ts' },
          { uuid: 'file-2', path: 'src/other.ts' },
        ]}
        onClose={jest.fn()}
        onFileChange={onFileChange}
      />
    );

    await screen.findByText('const old = 1;');
    fireEvent.mouseDown(screen.getByRole('combobox'));
    const otherFileOptions = await screen.findAllByText('src/other.ts');
    fireEvent.click(otherFileOptions[otherFileOptions.length - 1]);
    expect(onFileChange).toHaveBeenCalledWith('file-2', expect.anything());
  });
});
