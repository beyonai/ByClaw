import { openRawDocument } from './rawDecoder';
import { openImageDocument } from './imageDecoder';
import { loadRaw } from './loadRaw';
import { MAX_RAW_BYTES } from './rawTypes';

jest.mock('./loadRaw', () => ({ loadRaw: jest.fn() }));
describe('camera RAW decoder contract', () => {
  let decoder: Record<string, jest.Mock>;
  beforeEach(() => {
    jest.clearAllMocks();
    decoder = Object.fromEntries(
      [
        'open',
        'unpack',
        'dcrawProcess',
        'dispose',
        'setHalfSize',
        'setUseCameraWb',
        'setOutputColor',
        'setOutputBps',
        'setDemosaic',
      ].map((key) => [key, jest.fn()])
    );
    decoder.getRawWidth = jest.fn(() => 6000);
    decoder.getRawHeight = jest.fn(() => 4000);
    decoder.dcrawMakeMemImage = jest.fn(() => ({
      type_: 'LIBRAW_IMAGE_BITMAP',
      bits: 8,
      colors: 3,
      width: 2,
      height: 1,
      data: new Uint8Array([1, 2, 3, 4, 5, 6]),
    }));
    (loadRaw as jest.Mock).mockResolvedValue(decoder);
  });
  it('uses half-size sRGB processing, returns independent RGBA pixels and releases the decoder', async () => {
    const document = await openImageDocument(new ArrayBuffer(4), 'cr3');
    expect(document.count).toBe(1);
    expect(decoder.unpack).not.toHaveBeenCalled();
    const result = await document.render(0);
    expect(result.pixels).toEqual(new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]));
    expect(result.orientation).toBe(1);
    expect(decoder.setHalfSize).toHaveBeenCalledWith(1);
    expect(decoder.setOutputColor).toHaveBeenCalledWith(1);
    expect(decoder.setOutputBps).toHaveBeenCalledWith(8);
    expect(decoder.dispose).toHaveBeenCalledTimes(1);
    document.dispose();
    expect(decoder.dispose).toHaveBeenCalledTimes(1);
  });
  it('rejects excessive sensor dimensions before pixel allocation', async () => {
    decoder.getRawWidth.mockReturnValue(20000);
    decoder.getRawHeight.mockReturnValue(20000);
    await expect(openRawDocument(new ArrayBuffer(4))).rejects.toThrow('limit');
    expect(decoder.unpack).not.toHaveBeenCalled();
    expect(decoder.dispose).toHaveBeenCalled();
  });
  it('rejects invalid and oversized input before loading WASM', async () => {
    await expect(openRawDocument(new ArrayBuffer(0))).rejects.toThrow('invalid');
    await expect(openRawDocument({ byteLength: MAX_RAW_BYTES + 1 } as ArrayBuffer)).rejects.toThrow('limit');
    expect(loadRaw).not.toHaveBeenCalled();
  });
  it.each(['open', 'unpack', 'dcrawProcess', 'dcrawMakeMemImage'])('frees handles when %s fails', async (operation) => {
    decoder[operation].mockImplementation(() => {
      throw new Error('bad RAW');
    });
    const decode = async () => {
      const document = await openRawDocument(new ArrayBuffer(4));
      return document.render(0);
    };
    await expect(decode()).rejects.toThrow('bad RAW');
    expect(decoder.dispose).toHaveBeenCalledTimes(1);
  });
  it('allows disposal before rendering and rejects unexpected output layouts', async () => {
    const closed = await openRawDocument(new ArrayBuffer(4));
    closed.dispose();
    await expect(closed.render(0)).rejects.toThrow('closed');
    decoder.dcrawMakeMemImage.mockReturnValue({
      type_: 'LIBRAW_IMAGE_BITMAP',
      width: 2,
      height: 1,
      bits: 16,
      colors: 3,
      data: new Uint8Array(6),
    });
    const document = await openRawDocument(new ArrayBuffer(4));
    await expect(document.render(0)).rejects.toThrow('unsupported');
  });
});
