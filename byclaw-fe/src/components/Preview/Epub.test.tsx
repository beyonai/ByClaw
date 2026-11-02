import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Epub from './Epub';
import { createPreviewWorker } from './createPreviewWorker';
import { BinaryPreviewError, MAX_BINARY_PREVIEW_BYTES } from './binaryPreview';

jest.mock('./createPreviewWorker', () => ({ createPreviewWorker: jest.fn() }));
jest.mock('@umijs/max', () => ({ useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }) }));
const blob = () => {
  const file = new Blob(['epub']);
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(4) });
  return file;
};
describe('EPUB reader', () => {
  let worker: { request: jest.Mock; dispose: jest.Mock };
  beforeEach(() => {
    jest.clearAllMocks();
    worker = {
      request: jest.fn(async (operation, input) => {
        if (operation === 'openEpub') return { title: '中文书', chapters: [{ name: '开篇' }, { name: '结尾' }] };
        if (operation === 'epubChapter') return `<h1>chapter ${input.chapter}</h1>`;
        return [];
      }),
      dispose: jest.fn(),
    };
    (createPreviewWorker as jest.Mock).mockReturnValue(worker);
  });
  it('reads chapters in a sandbox and releases its worker on close', async () => {
    const { unmount } = render(<Epub data={blob()} />);
    const frame = await screen.findByTitle('中文书');
    expect(frame).toHaveAttribute('sandbox', '');
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(frame.getAttribute('srcdoc')).toContain('chapter 0');
    fireEvent.click(screen.getByRole('button', { name: 'fileRender.next' }));
    await waitFor(() => expect(screen.getByTitle('中文书').getAttribute('srcdoc')).toContain('chapter 1'));
    expect(screen.getByRole('button', { name: 'fileRender.next' })).toBeDisabled();
    unmount();
    expect(worker.dispose).toHaveBeenCalled();
  });
  it('ignores a pending old chapter after switching files', async () => {
    let resolve!: (value: string) => void;
    worker.request.mockImplementation(async (operation) => {
      if (operation === 'openEpub') return { title: 'old', chapters: [{ name: 'old' }] };
      return new Promise((done) => {
        resolve = done;
      });
    });
    const { rerender } = render(<Epub data={blob()} />);
    await waitFor(() => expect(worker.request).toHaveBeenCalledWith('epubChapter', { chapter: 0 }));
    const old = worker;
    worker = {
      request: jest.fn(async (operation) =>
        operation === 'openEpub' ? { title: 'new', chapters: [{ name: 'new chapter' }] } : '<p>new</p>'
      ),
      dispose: jest.fn(),
    };
    (createPreviewWorker as jest.Mock).mockReturnValue(worker);
    rerender(<Epub data={blob()} />);
    // 书名和章节名可以相同，只定位阅读 iframe，避免命中 Select 的章节标题。
    const isNewFrame = (title: string, element: Element | null) => title === 'new' && element?.tagName === 'IFRAME';
    const frame = await screen.findByTitle(isNewFrame);
    expect(frame.getAttribute('srcdoc')).toContain('<p>new</p>');
    await act(async () => resolve('<p>stale</p>'));
    expect(
      screen.queryByTitle((title, element) => title === 'old' && element?.tagName === 'IFRAME')
    ).not.toBeInTheDocument();
    expect(screen.getByTitle(isNewFrame)).toBe(frame);
    expect(frame.getAttribute('srcdoc')).toContain('<p>new</p>');
    expect(frame.getAttribute('srcdoc')).not.toContain('stale');
    expect(old.dispose).toHaveBeenCalled();
  });
  it('keeps navigation available after a damaged chapter', async () => {
    worker.request.mockImplementation(async (operation, input) => {
      if (operation === 'openEpub') return { title: 'book', chapters: [{ name: 'bad' }, { name: 'good' }] };
      if (!input.chapter) throw new BinaryPreviewError('invalid');
      return '<p>recovered</p>';
    });
    render(<Epub data={blob()} />);
    await screen.findByText('fileRender.epubFailed');
    fireEvent.click(screen.getByRole('button', { name: 'fileRender.next' }));
    expect((await screen.findByTitle('book')).getAttribute('srcdoc')).toContain('recovered');
  });
  it('rejects oversized input before starting a worker', async () => {
    const file = blob();
    Object.defineProperty(file, 'size', { value: MAX_BINARY_PREVIEW_BYTES + 1 });
    render(<Epub data={file} />);
    await screen.findByText('fileRender.epubLimit');
    expect(createPreviewWorker).not.toHaveBeenCalled();
  });
});
