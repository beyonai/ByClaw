import { act, render, screen, waitFor } from '@testing-library/react';
import { convertLegacyOfficePreview, MAX_LEGACY_PREVIEW_SIZE } from '@/service/filePreview';
import LegacyOffice from './LegacyOffice';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));
jest.mock('@/service/filePreview', () => ({
  convertLegacyOfficePreview: jest.fn(),
  MAX_LEGACY_PREVIEW_SIZE: 20 * 1024 * 1024,
}));
jest.mock('./Html', () => ({
  HtmlRender: ({ href }: { href: string }) => <iframe title="converted PDF" src={href} />,
}));

describe('legacy Office converted preview', () => {
  const convert = convertLegacyOfficePreview as jest.Mock;
  const createUrl = jest.fn();
  const revokeUrl = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    createUrl.mockReturnValue('blob:converted');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createUrl });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeUrl });
  });

  it.each(['doc', 'ppt'] as const)('displays a converted %s PDF and releases it on close', async (type) => {
    const source = new Blob(['original']);
    const pdf = new Blob(['%PDF-1.4'], { type: 'application/pdf' });
    convert.mockResolvedValue({ file: pdf });
    const { unmount } = render(<LegacyOffice data={source} type={type} fileName={`原文件.${type}`} />);
    expect(await screen.findByTitle('converted PDF')).toHaveAttribute('src', 'blob:converted');
    expect(convert).toHaveBeenCalledWith(source, `原文件.${type}`, expect.any(AbortController));
    expect(createUrl).toHaveBeenCalledWith(pdf);
    const controller = convert.mock.calls[0][2];
    unmount();
    expect(controller.signal.aborted).toBe(true);
    expect(revokeUrl).toHaveBeenCalledWith('blob:converted');
  });

  it('ignores an old conversion that resolves after changing files', async () => {
    let resolveOld!: (result: { file: Blob }) => void;
    convert.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        })
    );
    const nextPdf = new Blob(['%PDF new'], { type: 'application/pdf' });
    convert.mockResolvedValueOnce({ file: nextPdf });
    const { rerender } = render(<LegacyOffice data={new Blob(['old'])} type="doc" />);
    const controller = convert.mock.calls[0][2];
    rerender(<LegacyOffice data={new Blob(['new'])} type="ppt" />);
    await screen.findByTitle('converted PDF');
    await act(async () => resolveOld({ file: new Blob(['%PDF old'], { type: 'application/pdf' }) }));
    expect(controller.signal.aborted).toBe(true);
    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(createUrl).toHaveBeenCalledWith(nextPdf);
  });

  it('reports failed or invalid conversion responses without rendering JSON as PDF', async () => {
    convert.mockRejectedValueOnce(new Error('conversion failed'));
    convert.mockResolvedValueOnce({ file: new Blob(['{}'], { type: 'application/json' }) });
    const { rerender } = render(<LegacyOffice data={new Blob(['old'])} type="doc" />);
    expect(await screen.findByText('fileRender.legacyFailed')).toBeVisible();
    rerender(<LegacyOffice data={new Blob(['bad'])} type="ppt" />);
    await waitFor(() => expect(convert).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('fileRender.legacyFailed')).toBeVisible();
    expect(createUrl).not.toHaveBeenCalled();
  });

  it('rejects oversized input before sending it to the server', () => {
    const blob = new Blob(['large']);
    Object.defineProperty(blob, 'size', { value: MAX_LEGACY_PREVIEW_SIZE + 1 });
    render(<LegacyOffice data={blob} type="doc" />);
    expect(screen.getByText('fileRender.legacyTooLarge')).toBeVisible();
    expect(convert).not.toHaveBeenCalled();
  });
});
