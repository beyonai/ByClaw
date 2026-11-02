import { act, render, screen, waitFor } from '@testing-library/react';
import Rtf from './Rtf';
import { MAX_RTF_BYTES, renderRtf } from './rtfDecoder';
import { BinaryPreviewError } from './binaryPreview';

jest.mock('@umijs/max', () => ({ useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }) }));
jest.mock('./rtfDecoder', () => ({ MAX_RTF_BYTES: 2 * 1024 * 1024, renderRtf: jest.fn() }));

const blob = () => {
  const data = new Blob(['rtf']);
  Object.defineProperty(data, 'arrayBuffer', { value: jest.fn(async () => new ArrayBuffer(4)) });
  return data;
};

describe('RTF preview panel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (renderRtf as jest.Mock).mockResolvedValue('<html><body>正文</body></html>');
  });

  it('shows static content in a sandbox and explains formatting limitations', async () => {
    render(<Rtf data={blob()} title="报告.rtf" />);
    const frame = await screen.findByTitle('报告.rtf');
    expect(frame).toHaveAttribute('sandbox', '');
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(frame).toHaveAttribute('srcdoc', '<html><body>正文</body></html>');
    expect(screen.getByText('fileRender.rtfNotice')).toBeVisible();
  });

  it('checks size before reading and reports parse failures without an empty iframe', async () => {
    const large = blob();
    Object.defineProperty(large, 'size', { value: MAX_RTF_BYTES + 1 });
    const { rerender } = render(<Rtf data={large} />);
    expect(await screen.findByText('fileRender.rtfLimit')).toBeVisible();
    expect(large.arrayBuffer).not.toHaveBeenCalled();
    expect(renderRtf).not.toHaveBeenCalled();
    (renderRtf as jest.Mock).mockRejectedValue(new Error('damaged'));
    rerender(<Rtf data={blob()} />);
    expect(await screen.findByText('fileRender.rtfFailed')).toBeVisible();
    expect(screen.queryByTitle('fileRender.rtfDocument')).not.toBeInTheDocument();
  });

  it('ignores stale results and deactivates the renderer on switch and close', async () => {
    let resolveOld!: (value: string) => void;
    (renderRtf as jest.Mock).mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveOld = resolve;
        })
    );
    const { rerender, unmount } = render(<Rtf data={blob()} />);
    await waitFor(() => expect(renderRtf).toHaveBeenCalledTimes(1));
    const oldActive = (renderRtf as jest.Mock).mock.calls[0][2];
    rerender(<Rtf data={blob()} />);
    expect(await screen.findByTitle('fileRender.rtfDocument')).toHaveAttribute(
      'srcdoc',
      '<html><body>正文</body></html>'
    );
    await act(async () => resolveOld('<p>old</p>'));
    expect(oldActive()).toBe(false);
    expect(screen.getByTitle('fileRender.rtfDocument')).not.toHaveAttribute('srcdoc', '<p>old</p>');
    const currentActive = (renderRtf as jest.Mock).mock.calls[1][2];
    unmount();
    expect(currentActive()).toBe(false);
  });

  it('reports complexity limits from the parser', async () => {
    (renderRtf as jest.Mock).mockRejectedValue(new BinaryPreviewError('limit'));
    render(<Rtf data={blob()} />);
    expect(await screen.findByText('fileRender.rtfLimit')).toBeVisible();
  });
});
