import { act, render, screen, waitFor } from '@testing-library/react';
import MessageFilePreviewPanel from './MessageFilePreviewPanel';

jest.mock('@umijs/max', () => {
  const intl = { formatMessage: ({ id }: { id: string }) => id };
  return { useIntl: () => intl, getIntl: () => intl };
});
jest.mock('@/service/file', () => ({
  downloadResourceFile: jest.fn(),
  getDatasetDownloadParamsFromQueryFile: jest.fn(),
  downloadMinIOFileURL: '/download',
}));
jest.mock('@/utils/file', () => ({ getFileUrl: (value: string) => value }));
jest.mock('@/components/Preview/Twins', () => ({
  PreViewFile: ({ data, resolveHtmlResource }: any) => (
    <div data-testid="preview" data-size={data.size} data-resolver={String(!!resolveHtmlResource)} />
  ),
}));

it('reuses the shared panel for knowledge files, replacing downloads safely and preserving relative resources', async () => {
  let finish: (value: { file: Blob; fileName: string }) => void = () => {};
  const first = new Promise<{ file: Blob; fileName: string }>((resolve) => {
    finish = resolve;
  });
  const resolver = async () => new Blob(['asset']);
  const props = { fileType: 'md', fileName: 'README.md', onClose: jest.fn() };
  const { rerender } = render(
    <MessageFilePreviewPanel
      {...props}
      fileItem={{
        uid: 'a',
        fileType: 'file',
        status: 'done',
        downloadRequest: () => first,
        resolvePreviewResource: resolver,
      }}
    />
  );
  rerender(
    <MessageFilePreviewPanel
      {...props}
      fileItem={{
        uid: 'b',
        fileType: 'file',
        status: 'done',
        downloadRequest: async () => ({ file: new Blob(['newest']), fileName: 'README.md' }),
        resolvePreviewResource: resolver,
      }}
    />
  );
  await waitFor(() => expect(screen.getByTestId('preview')).toHaveAttribute('data-size', '6'));
  expect(screen.getByTestId('preview')).toHaveAttribute('data-resolver', 'true');
  await act(async () => finish({ file: new Blob(['old']), fileName: 'README.md' }));
  expect(screen.getByTestId('preview')).toHaveAttribute('data-size', '6');
});

it('keeps a visible error in the side panel when the download is empty', async () => {
  render(
    <MessageFilePreviewPanel
      fileType="md"
      fileName="empty.md"
      onClose={jest.fn()}
      fileItem={{
        uid: 'empty',
        fileType: 'file',
        status: 'done',
        downloadRequest: async () => ({ file: new Blob([]), fileName: 'empty.md' }),
      }}
    />
  );
  expect(await screen.findByRole('alert')).toHaveTextContent('preview.empty');
  expect(screen.queryByTestId('preview')).not.toBeInTheDocument();
});
