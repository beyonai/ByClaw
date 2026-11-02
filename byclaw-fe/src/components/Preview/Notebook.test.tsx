import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Notebook from './Notebook';
import { createPreviewWorker } from './createPreviewWorker';
import { BinaryPreviewError, MAX_BINARY_PREVIEW_BYTES } from './binaryPreview';

jest.mock('./createPreviewWorker', () => ({ createPreviewWorker: jest.fn() }));
jest.mock('@umijs/max', () => ({ useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }) }));
// 当前 Jest 不转换 Markdown 的 ESM 依赖；验证组件传入的安全选项和定制渲染器。
jest.mock('react-markdown', () => ({ children, skipHtml, components }: any) => (
  <div data-testid="markdown" data-skip-html={skipHtml}>
    {children}
    {components.a({ children: 'link', href: 'https://example.com' })}
    {components.img({ alt: 'remote image', src: 'https://example.com/a.png' })}
  </div>
));
jest.mock('remark-gfm', () => jest.fn());
const blob = () => {
  const file = new Blob(['notebook']);
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new ArrayBuffer(8) });
  return file;
};
describe('Notebook preview panel', () => {
  let worker: { request: jest.Mock; dispose: jest.Mock };
  beforeEach(() => {
    jest.clearAllMocks();
    worker = {
      request: jest.fn(async () => ({
        cells: [
          { type: 'markdown', source: '# heading', outputs: [] },
          ...Array.from({ length: 10 }, (_, index) => ({
            type: 'code',
            source: `<script>${index}</script>`,
            executionCount: index,
            outputs: [{ text: `saved ${index}` }],
          })),
        ],
        omitted: true,
      })),
      dispose: jest.fn(),
    };
    (createPreviewWorker as jest.Mock).mockReturnValue(worker);
  });
  it('paginates cells and displays code/output as text without active links or remote images', async () => {
    const { container, unmount } = render(<Notebook data={blob()} />);
    expect(await screen.findByText('saved 0')).toBeVisible();
    expect(screen.getByTestId('markdown')).toHaveAttribute('data-skip-html', 'true');
    expect(container.querySelector('script, img, a[href]')).toBeNull();
    expect(screen.getByText('<script>0</script>')).toBeVisible();
    expect(screen.getByText('fileRender.notebookOmitted')).toBeVisible();
    expect(screen.queryByText('saved 9')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle('2'));
    expect(screen.getByText('saved 9')).toBeVisible();
    expect(screen.queryByText('saved 0')).not.toBeInTheDocument();
    unmount();
    expect(worker.dispose).toHaveBeenCalled();
  });
  it('discards late notebook reads after switching files', async () => {
    let resolve!: (value: unknown) => void;
    worker.request.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    const { rerender } = render(<Notebook data={blob()} />);
    await waitFor(() => expect(worker.request).toHaveBeenCalled());
    rerender(<Notebook data={blob()} />);
    await screen.findByText('saved 0');
    await act(async () => resolve({ cells: [{ type: 'raw', source: 'stale', outputs: [] }], omitted: false }));
    expect(screen.queryByText('stale')).not.toBeInTheDocument();
    expect(worker.dispose).toHaveBeenCalled();
  });
  it.each([
    ['limit', 'notebookLimit'],
    ['invalid', 'notebookFailed'],
    ['timeout', 'binaryTimeout'],
  ] as const)('shows %s errors', async (code, key) => {
    worker.request.mockRejectedValue(new BinaryPreviewError(code));
    render(<Notebook data={blob()} />);
    expect(await screen.findByText(`fileRender.${key}`)).toBeVisible();
  });
  it('rejects oversized input before creating a worker', async () => {
    const data = blob();
    Object.defineProperty(data, 'size', { value: MAX_BINARY_PREVIEW_BYTES + 1 });
    render(<Notebook data={data} />);
    await screen.findByText('fileRender.notebookLimit');
    expect(createPreviewWorker).not.toHaveBeenCalled();
  });
});
