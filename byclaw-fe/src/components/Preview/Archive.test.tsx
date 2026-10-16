import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Archive from './Archive';
import { createPreviewWorker } from './createPreviewWorker';
import { BinaryPreviewError } from './binaryPreview';

jest.mock('./createPreviewWorker', () => ({ createPreviewWorker: jest.fn() }));
jest.mock('@umijs/max', () => ({ useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }) }));

const blob = () => {
  const data = new Blob(['zip']);
  Object.defineProperty(data, 'arrayBuffer', { value: async () => new ArrayBuffer(4) });
  return data;
};
const entries = [
  { name: '资料/', directory: true, previewable: false },
  { name: '资料/report.csv', directory: false, previewable: true },
  { name: 'nested.zip', directory: false, previewable: false },
];

describe('archive preview', () => {
  const originalText = Object.getOwnPropertyDescriptor(Blob.prototype, 'text');
  let worker: { request: jest.Mock; dispose: jest.Mock };
  let renderFile: jest.Mock;
  beforeEach(() => {
    jest.clearAllMocks();
    worker = {
      request: jest.fn(async (operation) => (operation === 'openZip' ? entries : new Uint8Array([65, 44, 66]).buffer)),
      dispose: jest.fn(),
    };
    (createPreviewWorker as jest.Mock).mockReturnValue(worker);
    renderFile = jest.fn((_, name) => <div data-testid="inner-file">{name}</div>);
  });
  afterEach(() => {
    if (originalText) Object.defineProperty(Blob.prototype, 'text', originalText);
    else delete (Blob.prototype as Partial<Blob>).text;
  });

  it('lists paths, extracts only the selected file, reuses its renderer and returns to the list', async () => {
    const { unmount } = render(<Archive data={blob()} renderFile={renderFile} />);
    await screen.findByText('资料/report.csv');
    expect(worker.request).toHaveBeenCalledTimes(1);
    expect(screen.getByText('nested.zip')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'common.preview' }));
    expect(await screen.findByTestId('inner-file')).toHaveTextContent('资料/report.csv');
    expect(worker.request).toHaveBeenLastCalledWith('zipEntry', { name: '资料/report.csv' });
    expect(renderFile.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(renderFile.mock.calls[0][0].type).toBe('text/csv');
    fireEvent.click(screen.getByText('fileRender.archiveBack'));
    expect(screen.getByText('资料/report.csv')).toBeVisible();
    unmount();
    expect(worker.dispose).toHaveBeenCalled();
  });

  it('ignores a pending extraction when another archive replaces it', async () => {
    let resolveOld!: (value: ArrayBuffer) => void;
    worker.request.mockImplementation(async (operation) => {
      if (operation === 'openZip') return entries;
      return new Promise((resolve) => {
        resolveOld = resolve;
      });
    });
    const { rerender } = render(<Archive data={blob()} renderFile={renderFile} />);
    fireEvent.click(await screen.findByRole('button', { name: 'common.preview' }));
    await waitFor(() => expect(worker.request).toHaveBeenCalledWith('zipEntry', { name: '资料/report.csv' }));
    const oldWorker = worker;
    worker = { request: jest.fn(async () => []), dispose: jest.fn() };
    (createPreviewWorker as jest.Mock).mockReturnValue(worker);
    rerender(<Archive data={blob()} renderFile={renderFile} />);
    await act(async () => resolveOld(new ArrayBuffer(4)));
    expect(renderFile).not.toHaveBeenCalled();
    expect(oldWorker.dispose).toHaveBeenCalled();
  });

  it('keeps the directory available after one entry exceeds extraction limits', async () => {
    worker.request.mockImplementation(async (operation) => {
      if (operation === 'openZip') return entries;
      throw new BinaryPreviewError('limit');
    });
    render(<Archive data={blob()} renderFile={renderFile} />);
    fireEvent.click(await screen.findByRole('button', { name: 'common.preview' }));
    expect(await screen.findByText('fileRender.archiveLimit')).toBeVisible();
    expect(screen.getByText('资料/report.csv')).toBeVisible();
    expect(renderFile).not.toHaveBeenCalled();
  });

  it('isolates HTML from the application and removes scripts and navigation', async () => {
    const source =
      '<script>parent.alert(1)</script><meta http-equiv="refresh" content="0;url=https://example.com"><h1>Report</h1><a href="https://example.com">link</a>';
    Object.defineProperty(Blob.prototype, 'text', { configurable: true, value: jest.fn().mockResolvedValue(source) });
    worker.request.mockImplementation(async (operation) =>
      operation === 'openZip' ? [{ name: 'report.html', directory: false, previewable: true }] : new ArrayBuffer(4)
    );
    render(<Archive data={blob()} renderFile={renderFile} />);
    fireEvent.click(await screen.findByRole('button', { name: 'common.preview' }));
    const frame = await screen.findByTitle('report.html');
    await waitFor(() => expect(frame.getAttribute('srcdoc')).toContain('<h1>Report</h1>'));
    expect(frame).toHaveAttribute('sandbox', '');
    expect(frame.getAttribute('srcdoc')).not.toContain('<script>');
    expect(frame.getAttribute('srcdoc')).not.toContain('refresh');
    expect(frame.getAttribute('srcdoc')).not.toContain('href=');
    expect(renderFile).not.toHaveBeenCalled();
  });
});
