import { openImageDocument } from './imageDecoder';
import { validateJxlDimensions } from './jxlDecoder';

const mockDecode = jest.fn();
jest.mock('@jsquash/jxl/decode.js', () => ({ __esModule: true, default: (buffer: ArrayBuffer) => mockDecode(buffer) }));

// 以下是合法尺寸头，不是完整图片；像素解码接口独立模拟，真实 WASM 解码需浏览器验收。
const twoByOne = () => new Uint8Array([0xff, 0x0a, 0, 0, 2, 0]).buffer;
const containerSignature = [0, 0, 0, 12, 74, 88, 76, 32, 13, 10, 135, 10];

function sizeHeader(width: number, height: number, selector: number, ratio = 0) {
  const bits: number[] = [];
  const write = (value: number, count: number) => {
    for (let bit = 0; bit < count; bit++) bits.push((value >>> bit) & 1);
  };
  write(0, 1);
  write(selector, 2);
  write(height - 1, [9, 13, 18, 30][selector]);
  write(ratio, 3);
  if (!ratio) {
    write(selector, 2);
    write(width - 1, [9, 13, 18, 30][selector]);
  }
  const bytes = new Uint8Array(2 + Math.ceil(bits.length / 8));
  bytes.set([0xff, 0x0a]);
  bits.forEach((value, index) => (bytes[2 + Math.floor(index / 8)] |= value << index % 8));
  return bytes.buffer;
}

function box(type: string, data: Uint8Array, sizeMode: 'normal' | 'extended' | 'rest' = 'normal') {
  const header = sizeMode === 'extended' ? 16 : 8;
  const result = new Uint8Array(header + data.length);
  const view = new DataView(result.buffer);
  view.setUint32(0, sizeMode === 'extended' ? 1 : sizeMode === 'rest' ? 0 : result.length);
  result.set(
    Array.from(type).map((char) => char.charCodeAt(0)),
    4
  );
  if (sizeMode === 'extended') view.setUint32(12, result.length);
  result.set(data, header);
  return result;
}

function container(...boxes: Uint8Array[]) {
  const result = new Uint8Array(12 + boxes.reduce((size, item) => size + item.length, 0));
  result.set(containerSignature);
  let offset = 12;
  boxes.forEach((item) => {
    result.set(item, offset);
    offset += item.length;
  });
  return result.buffer;
}

function partial(index: number, data: Uint8Array, last = false) {
  const result = new Uint8Array(4 + data.length);
  new DataView(result.buffer).setUint32(0, index + (last ? 0x80000000 : 0));
  result.set(data, 4);
  return box('jxlp', result);
}

describe('JPEG XL preflight and decoder lifecycle', () => {
  beforeEach(() => {
    mockDecode.mockReset();
    mockDecode.mockResolvedValue({
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 127]),
    });
  });

  it('reads explicit dimensions, compact dimensions and all fixed aspect ratios', () => {
    expect(validateJxlDimensions(twoByOne())).toEqual({ width: 2, height: 1 });
    expect(validateJxlDimensions(new Uint8Array([0xff, 0x0a, 0x41, 0]).buffer)).toEqual({ width: 8, height: 8 });
    // small=1, height=(1+1)*8, ratio=0, width=(3+1)*8。
    expect(validateJxlDimensions(new Uint8Array([0xff, 0x0a, 3, 6]).buffer)).toEqual({ width: 32, height: 16 });
    [120, 144, 160, 180, 213, 150, 240].forEach((width, index) => {
      expect(validateJxlDimensions(sizeHeader(0, 120, 0, index + 1))).toEqual({ width, height: 120 });
    });
  });

  it.each([0, 1, 2, 3])('reads the %s dimension selector without signed integer overflow', (selector) => {
    expect(validateJxlDimensions(sizeHeader(400, 300, selector))).toEqual({ width: 400, height: 300 });
  });

  it.each(['normal', 'extended', 'rest'] as const)('accepts a %s codestream box with preceding metadata', (mode) => {
    const buffer = container(box('Exif', new Uint8Array([1, 2, 3])), box('jxlc', new Uint8Array(twoByOne()), mode));
    expect(validateJxlDimensions(buffer)).toEqual({ width: 2, height: 1 });
  });

  it('collects a size header split across ordered partial codestream boxes', () => {
    const bytes = new Uint8Array(twoByOne());
    const buffer = container(
      partial(0, bytes.subarray(0, 1)),
      box('xml ', new Uint8Array()),
      partial(1, bytes.subarray(1, 3)),
      partial(2, bytes.subarray(3), true)
    );
    expect(validateJxlDimensions(buffer)).toEqual({ width: 2, height: 1 });
  });

  it('rejects inconsistent, truncated and overflowing containers before decoding', async () => {
    const bytes = new Uint8Array(twoByOne());
    const oversizedBox = box('jxlc', bytes, 'extended');
    new DataView(oversizedBox.buffer).setUint32(8, 0xffffffff);
    const cases = [
      new Uint8Array([0xff, 0x0a]).buffer,
      new Uint8Array([0, 1, 2, 3]).buffer,
      container(box('jxlc', bytes), box('jxlc', bytes)),
      container(partial(0, bytes)),
      container(partial(1, bytes, true)),
      container(partial(0, bytes, true), partial(1, bytes, true)),
      container(partial(0, bytes), box('jxlc', bytes)),
      container(box('jxlp', new Uint8Array(3))),
      container(oversizedBox),
      container(box('jxlc', bytes)).slice(0, -1),
    ];
    for (const buffer of cases) {
      await expect(openImageDocument(buffer, 'jxl')).rejects.toMatchObject({ code: 'invalid' });
    }
    expect(mockDecode).not.toHaveBeenCalled();
  });

  it('rejects oversized dimensions and pixel counts before loading WASM', async () => {
    for (const [width, height] of [
      [16385, 1],
      [8000, 8000],
      [2 ** 30, 1],
    ]) {
      await expect(openImageDocument(sizeHeader(width, height, 3), 'jxl')).rejects.toMatchObject({ code: 'limit' });
    }
    expect(mockDecode).not.toHaveBeenCalled();
  });

  it('decodes on demand, preserves alpha and rejects invalid pages and use after disposal', async () => {
    const buffer = twoByOne();
    const document = await openImageDocument(buffer, 'jxl');
    expect(document.count).toBe(1);
    expect(mockDecode).not.toHaveBeenCalled();
    await expect(document.render(1)).rejects.toMatchObject({ code: 'invalid' });
    const page = await document.render(0);
    expect(mockDecode).toHaveBeenCalledWith(buffer);
    expect(page).toMatchObject({ width: 2, height: 1, orientation: 1 });
    expect(Array.from(page.pixels)).toEqual([255, 0, 0, 255, 0, 255, 0, 127]);
    document.dispose();
    await expect(document.render(0)).rejects.toMatchObject({ code: 'closed' });
  });

  it('accepts decoder-applied orientation and honors typed-array offsets', async () => {
    const data = new Uint8ClampedArray([99, 99, 255, 0, 0, 255, 0, 255, 0, 127, 99]);
    mockDecode.mockResolvedValue({ width: 1, height: 2, data: data.subarray(2, 10) });
    const document = await openImageDocument(twoByOne(), 'jxl');
    const page = await document.render(0);
    expect(page).toMatchObject({ width: 1, height: 2, orientation: 1 });
    expect(page.pixels).toHaveLength(8);
    expect(page.pixels[7]).toBe(127);
  });

  it('rejects corrupt output and propagates decoder failures', async () => {
    const document = await openImageDocument(twoByOne(), 'jxl');
    mockDecode.mockResolvedValueOnce({ width: 3, height: 1, data: new Uint8ClampedArray(12) });
    await expect(document.render(0)).rejects.toMatchObject({ code: 'invalid' });
    mockDecode.mockResolvedValueOnce({ width: 2, height: 1, data: new Uint8ClampedArray(4) });
    await expect(document.render(0)).rejects.toMatchObject({ code: 'invalid' });
    mockDecode.mockRejectedValueOnce(new Error('Decoding error'));
    await expect(document.render(0)).rejects.toThrow('Decoding error');
  });

  it('discards pixels if the document is disposed while WASM loads', async () => {
    let finish!: (value: unknown) => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    mockDecode.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
          markStarted();
        })
    );
    const document = await openImageDocument(twoByOne(), 'jxl');
    const pending = document.render(0);
    await started;
    document.dispose();
    finish({ width: 2, height: 1, data: new Uint8ClampedArray(8) });
    await expect(pending).rejects.toMatchObject({ code: 'closed' });
  });
});
