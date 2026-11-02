import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Eml from './Eml';
import { createPreviewWorker } from './createPreviewWorker';
import { BinaryPreviewError, MAX_BINARY_PREVIEW_BYTES } from './binaryPreview';
import type { EmlContent } from './emlTypes';

jest.mock('./createPreviewWorker', () => ({ createPreviewWorker: jest.fn() }));
jest.mock('./Rtf', () => ({
  __esModule: true,
  default: ({ data, title }: { data: Blob; title: string }) => (
    <div data-testid="rtf-body" title={title} data-size={data.size} data-mime={data.type} />
  ),
}));
jest.mock('@umijs/max', () => ({ useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }) }));
const email: EmlContent = {
  subject: '中文邮件',
  from: 'sender@example.com',
  to: 'to@example.com',
  cc: 'cc@example.com',
  date: '2026-10-16',
  text: '<script>literal</script>',
  html: '<p>正文</p>',
  attachments: [{ id: 0, name: '报告.txt', mime: 'text/plain', buffer: new Uint8Array([97, 98, 99]).buffer }],
};
const file = () => {
  const blob = new Blob(['EML']);
  Object.defineProperty(blob, 'arrayBuffer', { value: async () => new ArrayBuffer(3) });
  return blob;
};
describe('EML reader', () => {
  let worker: { request: jest.Mock; dispose: jest.Mock };
  let createUrl: jest.Mock;
  let revokeUrl: jest.Mock;
  beforeEach(() => {
    jest.clearAllMocks();
    worker = { request: jest.fn(async () => email), dispose: jest.fn() };
    (createPreviewWorker as jest.Mock).mockReturnValue(worker);
    createUrl = jest.fn(() => 'blob:attachment');
    revokeUrl = jest.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createUrl });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeUrl });
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  it('shows message metadata, isolated HTML, plain text and attachment download with URL cleanup', async () => {
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { container, unmount } = render(<Eml data={file()} />);
    expect(await screen.findByText('中文邮件')).toBeVisible();
    expect(screen.getByText('sender@example.com')).toBeVisible();
    expect(screen.getByText('cc@example.com')).toBeVisible();
    const frame = screen.getByTitle('fileRender.emlBody');
    expect(frame).toHaveAttribute('sandbox', '');
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(frame.getAttribute('srcdoc')).toContain('<p>正文</p>');
    fireEvent.click(screen.getByText('fileRender.emlText'));
    expect(screen.getByText('<script>literal</script>')).toBeVisible();
    expect(container.querySelector('script')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'common.download' }));
    expect(click).toHaveBeenCalledTimes(1);
    expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe('报告.txt');
    const attachment = createUrl.mock.calls[0][0] as Blob;
    expect(attachment.size).toBe(3);
    expect(attachment.type).toBe('text/plain');
    unmount();
    expect(revokeUrl).toHaveBeenCalledWith('blob:attachment');
    expect(worker.dispose).toHaveBeenCalled();
  });
  it('does not show stale mail after switching files', async () => {
    let resolve!: (email: EmlContent) => void;
    worker.request.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    const { rerender } = render(<Eml data={file()} />);
    await waitFor(() => expect(worker.request).toHaveBeenCalled());
    rerender(<Eml data={file()} />);
    await screen.findByText('中文邮件');
    await act(async () => resolve({ ...email, subject: 'stale' }));
    expect(screen.queryByText('stale')).not.toBeInTheDocument();
    expect(worker.dispose).toHaveBeenCalled();
  });
  it.each([
    ['limit', 'emlLimit'],
    ['invalid', 'emlFailed'],
    ['timeout', 'binaryTimeout'],
  ] as const)('shows %s failures', async (code, key) => {
    worker.request.mockRejectedValue(new BinaryPreviewError(code));
    render(<Eml data={file()} />);
    expect(await screen.findByText(`fileRender.${key}`)).toBeVisible();
  });
  it('bounds input before starting the worker', async () => {
    const data = file();
    Object.defineProperty(data, 'size', { value: MAX_BINARY_PREVIEW_BYTES + 1 });
    render(<Eml data={data} />);
    await screen.findByText('fileRender.emlLimit');
    expect(createPreviewWorker).not.toHaveBeenCalled();
  });
  it('routes MSG to its decoder and indicates a damaged RTF body and linked attachments', async () => {
    worker.request.mockResolvedValue({
      ...email,
      text: '',
      html: '',
      bodyUnavailable: true,
      attachments: [{ ...email.attachments[0], unavailable: true, buffer: new ArrayBuffer(0) }],
    });
    render(<Eml data={file()} type="msg" />);
    expect(await screen.findByText('fileRender.msgRtfBody')).toBeVisible();
    expect(screen.getByText('fileRender.msgLinkedAttachment')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'common.download' })).not.toBeInTheDocument();
    expect(worker.request).toHaveBeenCalledWith('readMsg', expect.any(Object), expect.any(Array));
  });
  it('renders decoded RTF through the existing viewer while keeping metadata and attachments', async () => {
    worker.request.mockResolvedValue({ ...email, text: '', html: '', rtf: new ArrayBuffer(43) });
    render(<Eml data={file()} type="msg" />);
    const body = await screen.findByTestId('rtf-body');
    expect(body).toHaveAttribute('data-size', '43');
    expect(body).toHaveAttribute('data-mime', 'application/rtf');
    expect(body).toHaveAttribute('title', 'fileRender.emlBody');
    expect(screen.getByText('中文邮件')).toBeVisible();
    expect(screen.getByRole('button', { name: 'common.download' })).toBeVisible();
    expect(screen.queryByText('fileRender.msgRtfBody')).not.toBeInTheDocument();
    expect(screen.queryByText('fileRender.emlEmptyBody')).not.toBeInTheDocument();
  });
  it('uses an MSG-specific failure message', async () => {
    worker.request.mockRejectedValue(new BinaryPreviewError('unsupported'));
    render(<Eml data={file()} type="msg" />);
    expect(await screen.findByText('fileRender.msgFailed')).toBeVisible();
    expect(worker.dispose).toHaveBeenCalled();
  });
});
