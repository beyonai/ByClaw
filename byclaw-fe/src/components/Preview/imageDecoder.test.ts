import { openImageDocument } from './imageDecoder';
import { MAX_BINARY_PREVIEW_BYTES, validateImageSize, fitDecodedImage } from './binaryPreview';

const mockDecodeHeif = jest.fn();
jest.mock('libheif-js/libheif-wasm/libheif-bundle.mjs', () => ({
  __esModule: true,
  default: async () => ({
    HeifDecoder: class {
      decode(buffer: Uint8Array) {
        return mockDecodeHeif(buffer);
      }
    },
  }),
}));

// 自建两页标准 TIFF：每页一个 RGB 像素。走真实 UTIF 解码，避免仅验证 mock 路由。
function twoPageTiff() {
  const entryCount = 10;
  const directorySize = 2 + entryCount * 12 + 4;
  const buffer = new ArrayBuffer(8 + directorySize * 2 + 18);
  const view = new DataView(buffer);
  const little = true;
  view.setUint16(0, 0x4949, little);
  view.setUint16(2, 42, little);
  view.setUint32(4, 8, little);
  for (let page = 0; page < 2; page++) {
    const start = 8 + page * directorySize;
    const bits = 8 + directorySize * 2 + page * 9;
    const pixel = bits + 6;
    view.setUint16(start, entryCount, little);
    const entries = [
      [256, 4, 1, 1],
      [257, 4, 1, 1],
      [258, 3, 3, bits],
      [259, 3, 1, 1],
      [262, 3, 1, 2],
      [273, 4, 1, pixel],
      [274, 3, 1, page ? 6 : 1],
      [277, 3, 1, 3],
      [278, 4, 1, 1],
      [279, 4, 1, 3],
    ];
    entries.forEach(([tag, type, count, value], index) => {
      const offset = start + 2 + index * 12;
      view.setUint16(offset, tag, little);
      view.setUint16(offset + 2, type, little);
      view.setUint32(offset + 4, count, little);
      view.setUint32(offset + 8, value, little);
    });
    view.setUint32(start + 2 + entryCount * 12, page ? 0 : 8 + directorySize, little);
    [0, 2, 4].forEach((offset) => view.setUint16(bits + offset, 8, little));
    view.setUint8(pixel + page, 255);
  }
  return buffer;
}

describe('image document decoding', () => {
  it('decodes actual multi-page TIFF pixels on demand and retains page orientation', async () => {
    const document = await openImageDocument(twoPageTiff(), 'tiff');
    expect(document.count).toBe(2);
    const first = await document.render(0);
    const second = await document.render(1);
    expect(Array.from(first.pixels)).toEqual([255, 0, 0, 255]);
    expect(Array.from(second.pixels)).toEqual([0, 255, 0, 255]);
    expect(second.orientation).toBe(6);
    expect(Array.from((await document.render(0)).pixels)).toEqual([255, 0, 0, 255]);
    await expect(document.render(2)).rejects.toMatchObject({ code: 'invalid' });
    document.dispose();
  });

  it.each(['heic', 'heif'])('decodes %s pixels and releases native image handles', async (type) => {
    const image = {
      get_width: () => 2,
      get_height: () => 1,
      free: jest.fn(),
      display: (target: any, callback: (result: any) => void) => {
        target.data.fill(255);
        callback(target);
      },
    };
    mockDecodeHeif.mockReturnValue([image]);
    const document = await openImageDocument(new ArrayBuffer(16), type);
    const page = await document.render(0);
    expect(page.width).toBe(2);
    expect(page.pixels).toHaveLength(8);
    expect(page.pixels[0]).toBe(255);
    document.dispose();
    expect(image.free).toHaveBeenCalledTimes(2);
    await expect(document.render(0)).rejects.toMatchObject({ code: 'closed' });
  });

  it('checks HEIF dimensions before allocating RGBA pixels and frees handles on rejection', async () => {
    const image = { get_width: () => 100000, get_height: () => 100000, free: jest.fn(), display: jest.fn() };
    mockDecodeHeif.mockReturnValue([image]);
    await expect(openImageDocument(new ArrayBuffer(16), 'heic')).rejects.toMatchObject({ code: 'limit' });
    expect(image.display).not.toHaveBeenCalled();
    expect(image.free).toHaveBeenCalled();
  });

  it('rejects invalid dimensions, file signatures and oversized input', async () => {
    expect(() => validateImageSize(0, 100)).toThrow('invalid');
    expect(() => validateImageSize(8000, 8000)).toThrow('limit');
    await expect(openImageDocument(new ArrayBuffer(10), 'tiff')).rejects.toMatchObject({ code: 'invalid' });
    await expect(openImageDocument(new ArrayBuffer(MAX_BINARY_PREVIEW_BYTES + 1), 'heic')).rejects.toMatchObject({
      code: 'limit',
    });
  });

  it('bounds canvas dimensions while preserving pixel alpha and TIFF orientation', () => {
    const pixels = new Uint8Array(8192 * 4).fill(127);
    const fitted = fitDecodedImage({ width: 8192, height: 1, orientation: 6, pixels });
    expect(fitted.width).toBe(4096);
    expect(fitted.height).toBe(1);
    expect(fitted.orientation).toBe(6);
    expect(fitted.pixels).toHaveLength(4096 * 4);
    expect(fitted.pixels[3]).toBe(127);
  });

  it('rejects unsupported TIFF compression instead of presenting a blank successful preview', async () => {
    const buffer = twoPageTiff();
    // 第一页第四个 IFD 项为 Compression。
    new DataView(buffer).setUint32(8 + 2 + 3 * 12 + 8, 999, true);
    await expect(openImageDocument(buffer, 'tif')).rejects.toMatchObject({ code: 'unsupported' });
  });
});
