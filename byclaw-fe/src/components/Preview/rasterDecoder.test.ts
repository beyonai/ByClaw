/** @jest-environment node */
import { decodePpm, decodeTga } from './rasterDecoder';
import { MAX_BINARY_PREVIEW_BYTES } from './binaryPreview';

const ppm = (header: string, pixels: number[] = []) => {
  const start = new TextEncoder().encode(header);
  const bytes = new Uint8Array(start.length + pixels.length);
  bytes.set(start);
  bytes.set(pixels, start.length);
  return bytes.buffer;
};
const tga = (
  values: number[],
  options: { kind?: number; depth?: number; descriptor?: number; width?: number; height?: number } = {}
) => {
  const bytes = new Uint8Array(18 + values.length);
  bytes[2] = options.kind ?? 2;
  new DataView(bytes.buffer).setUint16(12, options.width ?? 1, true);
  new DataView(bytes.buffer).setUint16(14, options.height ?? 1, true);
  bytes[16] = options.depth ?? 24;
  bytes[17] = options.descriptor ?? 32;
  bytes.set(values, 18);
  return bytes.buffer;
};

describe('PPM images', () => {
  it('reads P3 comments and normalizes non-255 ranges', () => {
    const page = decodePpm(ppm('P3\n# sample\n2 1\n15\n15 0 0 # red\n0 15 0\n'));
    expect([page.width, page.height]).toEqual([2, 1]);
    expect(Array.from(page.pixels)).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
  });
  it('preserves whitespace-valued first binary pixels and supports 16-bit big-endian samples', () => {
    expect(Array.from(decodePpm(ppm('P6\n1 1\n255\n', [10, 32, 35])).pixels)).toEqual([10, 32, 35, 255]);
    expect(Array.from(decodePpm(ppm('P6\r\n1 1\r\n255\r\n', [10, 32, 35])).pixels)).toEqual([10, 32, 35, 255]);
    expect(Array.from(decodePpm(ppm('P6\n1 1\n65535\n', [255, 255, 128, 0, 0, 0])).pixels)).toEqual([255, 128, 0, 255]);
  });
  it.each(['P6\n1 1\n0\n', 'P6\n1 1\n255\n', 'P3\n1 1\n10\n11 0 0', 'P3\n1 1\n255\n1 2 3 4'])(
    'rejects malformed raster %s',
    (source) => {
      expect(() => decodePpm(ppm(source))).toThrow('invalid');
    }
  );
  it('checks input and dimensions before allocating pixels', () => {
    expect(() => decodePpm(new ArrayBuffer(MAX_BINARY_PREVIEW_BYTES + 1))).toThrow('limit');
    expect(() => decodePpm(ppm('P6\n20000 20000\n255\n'))).toThrow('limit');
    expect(() => decodePpm(ppm('P6\n0 1\n255\n'))).toThrow('invalid');
  });
});

describe('TGA images', () => {
  it.each([0, 16, 32, 48])('normalizes descriptor origin %i to top-left', (descriptor) => {
    // 存储顺序的四像素为红、绿、蓝、白；各起点映射必须保持像素坐标一致。
    const page = decodeTga(tga([0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255], { descriptor, width: 2, height: 2 }));
    const first = (descriptor & 32 ? 0 : 2) + (descriptor & 16 ? 1 : 0);
    expect(Array.from(page.pixels.subarray(first * 4, first * 4 + 4))).toEqual([255, 0, 0, 255]);
    expect(page.orientation).toBe(1);
  });
  it('decodes RLE truecolor with alpha and raw grayscale', () => {
    const page = decodeTga(tga([0x81, 30, 20, 10, 128], { kind: 10, depth: 32, descriptor: 40, width: 2 }));
    expect(Array.from(page.pixels)).toEqual([10, 20, 30, 128, 10, 20, 30, 128]);
    expect(Array.from(decodeTga(tga([64], { kind: 3, depth: 8 })).pixels)).toEqual([64, 64, 64, 255]);
  });
  it('reads palette indices with nonzero color-map origins', () => {
    const input = tga([0, 0, 255, 5], { kind: 1, depth: 8 });
    const bytes = new Uint8Array(input);
    bytes[1] = 1;
    bytes[3] = 5;
    bytes[5] = 1;
    bytes[7] = 24;
    expect(Array.from(decodeTga(input).pixels)).toEqual([255, 0, 0, 255]);
    bytes[21] = 4;
    expect(() => decodeTga(input)).toThrow('invalid');
  });
  it('rejects truncated/RLE overflow and unsupported interleaving', () => {
    expect(() => decodeTga(tga([0, 0]))).toThrow('invalid');
    expect(() => decodeTga(tga([0x82, 0, 0, 255], { kind: 10, width: 2 }))).toThrow('invalid');
    expect(() => decodeTga(tga([0, 0, 255], { descriptor: 64 }))).toThrow('unsupported');
    expect(() => decodeTga(tga([], { width: 20000, height: 20000 }))).toThrow('limit');
  });
});
