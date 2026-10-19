import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DecodedImage, { paintDecodedImage } from './DecodedImage';
import { createPreviewWorker } from './createPreviewWorker';
import { BinaryPreviewError, MAX_BINARY_PREVIEW_BYTES } from './binaryPreview';
import { MAX_RAW_BYTES } from './rawTypes';

jest.mock('./createPreviewWorker', () => ({ createPreviewWorker: jest.fn() }));
jest.mock('@umijs/max', () => ({ useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }) }));

const pixels = { width: 2, height: 1, orientation: 1, pixels: new Uint8Array(8) };
const blob = () => {
  const data = new Blob(['image']);
  Object.defineProperty(data, 'arrayBuffer', { value: async () => new ArrayBuffer(4) });
  return data;
};

describe('decoded image preview', () => {
  let context: {
    putImageData: jest.Mock;
    setTransform: jest.Mock;
    drawImage: jest.Mock;
    translate: jest.Mock;
    rotate: jest.Mock;
  };
  let worker: { request: jest.Mock; dispose: jest.Mock };
  beforeEach(() => {
    jest.clearAllMocks();
    context = {
      putImageData: jest.fn(),
      setTransform: jest.fn(),
      drawImage: jest.fn(),
      translate: jest.fn(),
      rotate: jest.fn(),
    };
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as any);
    Object.defineProperty(global, 'ImageData', {
      configurable: true,
      value: class {
        constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
      },
    });
    worker = { request: jest.fn(async (operation) => (operation === 'openImage' ? 2 : pixels)), dispose: jest.fn() };
    (createPreviewWorker as jest.Mock).mockReturnValue(worker);
  });
  afterEach(() => jest.restoreAllMocks());

  it('shows decoded pixels, zooms, rotates, changes page and terminates on close', async () => {
    const { unmount } = render(<DecodedImage data={blob()} type="tiff" title="scan.tiff" />);
    await waitFor(() => expect(context.putImageData).toHaveBeenCalled());
    const image = screen.getByRole('img', { name: 'scan.tiff' });
    fireEvent.click(screen.getByText('fileRender.zoomIn'));
    expect(image).toHaveStyle({ width: '125%' });
    fireEvent.click(screen.getByText('fileRender.rotate'));
    expect(image).toHaveAttribute('width', '1');
    expect(image).toHaveAttribute('height', '2');
    fireEvent.click(screen.getByTitle('Next Page'));
    await waitFor(() => expect(worker.request).toHaveBeenCalledWith('imagePage', { page: 1 }));
    await waitFor(() => expect(image).toHaveStyle({ width: '100%' }));
    unmount();
    expect(worker.dispose).toHaveBeenCalled();
  });

  it('does not paint an old page after switching files', async () => {
    let resolveOld!: (value: typeof pixels) => void;
    worker.request.mockImplementation(async (operation) => {
      if (operation === 'openImage') return 1;
      return new Promise((resolve) => {
        resolveOld = resolve;
      });
    });
    const { rerender } = render(<DecodedImage data={blob()} type="tiff" />);
    await waitFor(() => expect(worker.request).toHaveBeenCalledWith('imagePage', { page: 0 }));
    const oldWorker = worker;
    const nextPixels = { ...pixels, width: 1, height: 2 };
    worker = {
      request: jest.fn(async (operation) => (operation === 'openImage' ? 1 : nextPixels)),
      dispose: jest.fn(),
    };
    (createPreviewWorker as jest.Mock).mockReturnValue(worker);
    rerender(<DecodedImage data={blob()} type="heic" />);
    await waitFor(() => expect(context.putImageData).toHaveBeenCalledTimes(1));
    await act(async () => resolveOld(pixels));
    expect(context.putImageData).toHaveBeenCalledTimes(1);
    expect(oldWorker.dispose).toHaveBeenCalled();
  });

  it('rejects oversized input before starting a worker and displays decoding failures', async () => {
    const large = blob();
    Object.defineProperty(large, 'size', { value: MAX_BINARY_PREVIEW_BYTES + 1 });
    const { rerender } = render(<DecodedImage data={large} type="heic" />);
    expect(await screen.findByText('fileRender.imageLimit')).toBeVisible();
    expect(createPreviewWorker).not.toHaveBeenCalled();
    worker.request.mockRejectedValue(new BinaryPreviewError('invalid'));
    rerender(<DecodedImage data={blob()} type="heic" />);
    expect(await screen.findByText('fileRender.imageDecodeFailed')).toBeVisible();
  });

  it('renders JXL through the worker and explains the static preview boundary', async () => {
    worker.request.mockImplementation(async (operation) => (operation === 'openImage' ? 1 : pixels));
    render(<DecodedImage data={blob()} type="jxl" title="照片.JXL" />);
    await waitFor(() => expect(context.putImageData).toHaveBeenCalled());
    expect(worker.request).toHaveBeenCalledWith('openImage', { buffer: expect.any(ArrayBuffer), type: 'jxl' }, [
      expect.any(ArrayBuffer),
    ]);
    expect(screen.getByText('fileRender.staticPhotoNotice')).toBeVisible();
    expect(screen.getByRole('img', { name: '照片.JXL' })).toBeVisible();
    expect(screen.queryByTitle('Next Page')).not.toBeInTheDocument();
  });

  it.each(['jp2', 'ppm', 'tga'])('renders %s in the existing zoom/rotation viewer', async (type) => {
    worker.request.mockImplementation(async (operation) => (operation === 'openImage' ? 1 : pixels));
    render(<DecodedImage data={blob()} type={type} title={`sample.${type}`} />);
    await waitFor(() => expect(context.putImageData).toHaveBeenCalled());
    expect(worker.request).toHaveBeenCalledWith('openImage', { buffer: expect.any(ArrayBuffer), type }, [
      expect.any(ArrayBuffer),
    ]);
    fireEvent.click(screen.getByText('fileRender.rotate'));
    expect(screen.getByRole('img', { name: `sample.${type}` })).toHaveAttribute('height', '2');
    expect(screen.queryByTitle('Next Page')).not.toBeInTheDocument();
  });
  it('explains JP2 limits separately from ordinary photos', async () => {
    worker.request.mockRejectedValue(new BinaryPreviewError('limit'));
    render(<DecodedImage data={blob()} type="jp2" />);
    expect(await screen.findByText('fileRender.jp2Limit')).toBeVisible();
    expect(screen.queryByText('fileRender.imageLimit')).not.toBeInTheDocument();
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('applies TIFF orientation %s without clipping rotated pages', (orientation) => {
    const canvas = document.createElement('canvas');
    paintDecodedImage(canvas, { ...pixels, orientation });
    expect(canvas.width).toBe(orientation >= 5 ? 1 : 2);
    expect(canvas.height).toBe(orientation >= 5 ? 2 : 1);
    expect(context.setTransform).toHaveBeenCalled();
  });

  it('allows RAW files above 20 MiB, explains processing and enforces the separate 50 MiB cap', async () => {
    worker.request.mockImplementation(async (operation) => (operation === 'openImage' ? 1 : pixels));
    const file = blob();
    Object.defineProperty(file, 'size', { value: MAX_BINARY_PREVIEW_BYTES + 1 });
    const { rerender } = render(<DecodedImage data={file} type="dng" />);
    await waitFor(() => expect(context.putImageData).toHaveBeenCalled());
    expect(screen.getByText('fileRender.rawNotice')).toBeVisible();
    const large = blob();
    Object.defineProperty(large, 'size', { value: MAX_RAW_BYTES + 1 });
    rerender(<DecodedImage data={large} type="dng" />);
    await screen.findByText('fileRender.rawLimit');
    expect(createPreviewWorker).toHaveBeenCalledTimes(1);
  });
});
