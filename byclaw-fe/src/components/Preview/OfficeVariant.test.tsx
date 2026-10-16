import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import OfficeVariant from './OfficeVariant';
import { createPreviewWorker } from './createPreviewWorker';
import { OFFICE_VARIANTS, type OfficeVariantType } from './officeVariantTypes';
import { BinaryPreviewError, MAX_BINARY_PREVIEW_BYTES } from './binaryPreview';

jest.mock('./createPreviewWorker', () => ({ createPreviewWorker: jest.fn() }));
jest.mock('@umijs/max', () => ({ useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }) }));
const mockOffice = jest.fn();
jest.mock('./Office', () => ({
  Office: (props: any) => {
    mockOffice(props);
    return (
      <button type="button" onClick={props.onPreviewError}>
        {props.type}
      </button>
    );
  },
}));
const file = () => {
  const blob = new Blob(['original']);
  Object.defineProperty(blob, 'arrayBuffer', { value: async () => new ArrayBuffer(8) });
  return blob;
};
describe('Office variant panel', () => {
  let worker: { request: jest.Mock; dispose: jest.Mock };
  beforeEach(() => {
    jest.clearAllMocks();
    worker = { request: jest.fn(async () => new Uint8Array([1, 2, 3]).buffer), dispose: jest.fn() };
    (createPreviewWorker as jest.Mock).mockReturnValue(worker);
  });
  it.each(Object.keys(OFFICE_VARIANTS) as OfficeVariantType[])(
    'renders the prepared %s copy through its existing viewer',
    async (type) => {
      const data = file();
      const { unmount } = render(<OfficeVariant data={data} type={type} />);
      expect(await screen.findByRole('button', { name: OFFICE_VARIANTS[type] })).toBeVisible();
      expect(worker.request).toHaveBeenCalledWith(
        'prepareOfficeVariant',
        expect.objectContaining({ type }),
        expect.any(Array)
      );
      const props = mockOffice.mock.calls[mockOffice.mock.calls.length - 1][0];
      expect(props.data).toBeInstanceOf(Blob);
      expect(props.data).not.toBe(data);
      expect(props.data.size).toBe(3);
      unmount();
      expect(worker.dispose).toHaveBeenCalled();
    }
  );
  it('shows downstream renderer failures without losing the parent download control', async () => {
    render(<OfficeVariant data={file()} type="docm" />);
    fireEvent.click(await screen.findByRole('button', { name: 'docx' }));
    expect(screen.getByText('fileRender.officeVariantFailed')).toBeVisible();
  });
  it.each([
    ['limit', 'officeVariantLimit'],
    ['invalid', 'officeVariantFailed'],
    ['timeout', 'binaryTimeout'],
  ] as const)('handles %s worker errors', async (code, key) => {
    worker.request.mockRejectedValue(new BinaryPreviewError(code));
    render(<OfficeVariant data={file()} type="xlsm" />);
    expect(await screen.findByText(`fileRender.${key}`)).toBeVisible();
    expect(mockOffice).not.toHaveBeenCalled();
  });
  it('ignores a late prepared copy after changing files', async () => {
    let resolve!: (buffer: ArrayBuffer) => void;
    worker.request.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    const { rerender } = render(<OfficeVariant data={file()} type="docm" />);
    await waitFor(() => expect(worker.request).toHaveBeenCalled());
    rerender(<OfficeVariant data={file()} type="pptm" />);
    await screen.findByRole('button', { name: 'pptx' });
    await act(async () => resolve(new ArrayBuffer(99)));
    expect(mockOffice.mock.calls[mockOffice.mock.calls.length - 1][0].data.size).toBe(3);
    expect(screen.queryByRole('button', { name: 'docx' })).not.toBeInTheDocument();
  });
  it('rejects large inputs before starting the worker', async () => {
    const data = file();
    Object.defineProperty(data, 'size', { value: MAX_BINARY_PREVIEW_BYTES + 1 });
    render(<OfficeVariant data={data} type="dotx" />);
    await screen.findByText('fileRender.officeVariantLimit');
    expect(createPreviewWorker).not.toHaveBeenCalled();
  });
  it('does not reuse an old copy or apply its renderer error after switching files', async () => {
    const { rerender } = render(<OfficeVariant data={file()} type="docm" />);
    await screen.findByRole('button', { name: 'docx' });
    const oldProps = mockOffice.mock.calls[mockOffice.mock.calls.length - 1][0];
    mockOffice.mockClear();
    rerender(<OfficeVariant data={file()} type="xlsm" />);
    await screen.findByRole('button', { name: 'xlsx' });
    expect(mockOffice.mock.calls.every(([props]) => props.data !== oldProps.data)).toBe(true);
    act(() => oldProps.onPreviewError());
    expect(screen.getByRole('button', { name: 'xlsx' })).toBeVisible();
    expect(screen.queryByText('fileRender.officeVariantFailed')).not.toBeInTheDocument();
  });
});
