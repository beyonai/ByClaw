import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import OpenDocument from './OpenDocument';
import { createPreviewWorker } from './createPreviewWorker';
import { BinaryPreviewError, MAX_BINARY_PREVIEW_BYTES } from './binaryPreview';

jest.mock('./createPreviewWorker', () => ({ createPreviewWorker: jest.fn() }));
jest.mock('@umijs/max', () => ({ useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }) }));
const blob = () => {
  const file = new Blob(['odf']);
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(3) });
  return file;
};
describe('OpenDocument preview panel', () => {
  let worker: { request: jest.Mock; dispose: jest.Mock };
  beforeEach(() => {
    jest.clearAllMocks();
    worker = {
      request: jest.fn(async () => ({
        pages: [
          { name: 'first', html: '<h1>first</h1>' },
          { name: 'second', html: '<p>second</p>' },
        ],
        omitted: false,
      })),
      dispose: jest.fn(),
    };
    (createPreviewWorker as jest.Mock).mockReturnValue(worker);
  });
  it('renders static slide pages in an isolated frame and releases the worker', async () => {
    const { unmount } = render(<OpenDocument data={blob()} type="odp" title="slides.odp" />);
    const frame = await screen.findByTitle('slides.odp');
    expect(frame).toHaveAttribute('sandbox', '');
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(frame.getAttribute('srcdoc')).toContain('<h1>first</h1>');
    fireEvent.click(screen.getByTitle('2'));
    expect(screen.getByTitle('slides.odp').getAttribute('srcdoc')).toContain('<p>second</p>');
    expect(worker.request).toHaveBeenCalledWith(
      'readOpenDocument',
      expect.objectContaining({ type: 'odp' }),
      expect.any(Array)
    );
    unmount();
    expect(worker.dispose).toHaveBeenCalled();
  });
  it('ignores old results after switching files', async () => {
    let resolve!: (value: unknown) => void;
    worker.request.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    const { rerender } = render(<OpenDocument data={blob()} type="odt" title="old" />);
    await waitFor(() => expect(worker.request).toHaveBeenCalled());
    rerender(<OpenDocument data={blob()} type="odp" title="new" />);
    await screen.findByTitle('new');
    await act(async () => resolve({ pages: [{ name: '', html: '<p>stale</p>' }], omitted: false }));
    expect(screen.getByTitle('new').getAttribute('srcdoc')).not.toContain('stale');
    expect(worker.dispose).toHaveBeenCalled();
  });
  it.each([
    ['limit', 'openDocumentLimit'],
    ['invalid', 'openDocumentFailed'],
    ['timeout', 'binaryTimeout'],
  ] as const)('shows %s errors', async (code, key) => {
    worker.request.mockRejectedValue(new BinaryPreviewError(code));
    render(<OpenDocument data={blob()} type="odt" />);
    expect(await screen.findByText(`fileRender.${key}`)).toBeVisible();
    expect(screen.queryByTitle('fileRender.openDocumentTitle')).not.toBeInTheDocument();
  });
  it('rejects oversized input before creating a worker', async () => {
    const data = blob();
    Object.defineProperty(data, 'size', { value: MAX_BINARY_PREVIEW_BYTES + 1 });
    render(<OpenDocument data={data} type="odt" />);
    await screen.findByText('fileRender.openDocumentLimit');
    expect(createPreviewWorker).not.toHaveBeenCalled();
  });
});
