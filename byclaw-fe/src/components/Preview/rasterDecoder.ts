import {
  BinaryPreviewError,
  MAX_BINARY_PREVIEW_BYTES,
  validateImageSize,
  type DecodedImagePage,
} from './binaryPreview';

const invalid = () => new BinaryPreviewError('invalid');
const whitespace = (byte: number) => byte === 32 || (byte >= 9 && byte <= 13);

/** P3/P6：先校验尺寸，二进制光栅前仅消费一个分隔符，不能吞掉值为换行/空格的像素。 */
export function decodePpm(buffer: ArrayBuffer): DecodedImagePage {
  if (buffer.byteLength > MAX_BINARY_PREVIEW_BYTES) throw new BinaryPreviewError('limit');
  const bytes = new Uint8Array(buffer);
  let cursor = 0;
  const skip = () => {
    while (cursor < bytes.length) {
      if (whitespace(bytes[cursor])) cursor++;
      else if (bytes[cursor] === 35) {
        while (cursor < bytes.length && bytes[cursor] !== 10 && bytes[cursor] !== 13) cursor++;
      } else break;
    }
  };
  const token = () => {
    skip();
    const start = cursor;
    while (cursor < bytes.length && !whitespace(bytes[cursor]) && bytes[cursor] !== 35) {
      if (cursor - start >= 10) throw invalid();
      cursor++;
    }
    if (cursor === start) throw invalid();
    return String.fromCharCode(...bytes.subarray(start, cursor));
  };
  const number = () => {
    const value = token();
    if (!/^\d+$/.test(value)) throw invalid();
    return Number(value);
  };
  const kind = token();
  if (!['P3', 'P6'].includes(kind)) throw invalid();
  const width = number();
  const height = number();
  validateImageSize(width, height);
  const max = number();
  if (max < 1 || max > 65535) throw invalid();
  const sampleBytes = max < 256 ? 1 : 2;
  const samples = width * height * 3;
  if (kind === 'P6') {
    if (!whitespace(bytes[cursor])) throw invalid();
    const separator = bytes[cursor++];
    // 兼容 CRLF 写入工具，仅在长度证明它不是首个像素时消费 LF。
    if (separator === 13 && bytes[cursor] === 10 && bytes.length - cursor === samples * sampleBytes + 1) cursor++;
    if (bytes.length - cursor !== samples * sampleBytes) throw invalid();
  } else if (bytes.length - cursor < samples) throw invalid();
  const pixels = new Uint8Array(width * height * 4);
  for (let index = 0; index < samples; index++) {
    let value: number;
    if (kind === 'P3') value = number();
    else if (sampleBytes === 2) value = (bytes[cursor++] << 8) | bytes[cursor++];
    else value = bytes[cursor++];
    if (value > max) throw invalid();
    const target = Math.floor(index / 3) * 4;
    pixels[target + (index % 3)] = Math.round((value * 255) / max);
    pixels[target + 3] = 255;
  }
  if (kind === 'P3') {
    skip();
    if (cursor !== bytes.length) throw invalid();
  }
  return { width, height, pixels, orientation: 1 };
}

/** TGA：读取颜色表/灰度/真彩色及 RLE，按描述符将四种存储方向统一成左上起点。 */
export function decodeTga(buffer: ArrayBuffer): DecodedImagePage {
  if (buffer.byteLength > MAX_BINARY_PREVIEW_BYTES) throw new BinaryPreviewError('limit');
  if (buffer.byteLength < 18) throw invalid();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const kind = bytes[2];
  const indexed = kind === 1 || kind === 9;
  const gray = kind === 3 || kind === 11;
  if (![1, 2, 3, 9, 10, 11].includes(kind) || bytes[17] & 0xc0) throw new BinaryPreviewError('unsupported');
  const width = view.getUint16(12, true);
  const height = view.getUint16(14, true);
  validateImageSize(width, height);
  const depth = bytes[16];
  const alpha = bytes[17] & 15;
  if (!(indexed ? [8, 16] : gray ? [8, 16] : [15, 16, 24, 32]).includes(depth))
    throw new BinaryPreviewError('unsupported');
  if (bytes[1] !== (indexed ? 1 : 0)) throw new BinaryPreviewError('unsupported');
  let cursor = 18 + bytes[0];
  const need = (count: number) => {
    if (cursor + count > bytes.length) throw invalid();
  };
  const readColor = (bits: number, grayscale = false): number[] => {
    need(Math.ceil(bits / 8));
    if (grayscale) {
      const value = bytes[cursor++];
      const opacity = bits === 16 ? bytes[cursor++] : 255;
      return [value, value, value, alpha ? opacity : 255];
    }
    if (bits === 15 || bits === 16) {
      const value = bytes[cursor++] | (bytes[cursor++] << 8);
      return [
        Math.round((((value >> 10) & 31) * 255) / 31),
        Math.round((((value >> 5) & 31) * 255) / 31),
        Math.round(((value & 31) * 255) / 31),
        bits === 16 && alpha ? (value & 0x8000 ? 255 : 0) : 255,
      ];
    }
    const blue = bytes[cursor++];
    const green = bytes[cursor++];
    const red = bytes[cursor++];
    const opacity = bits === 32 ? bytes[cursor++] : 255;
    return [red, green, blue, alpha ? opacity : 255];
  };
  const palette: number[][] = [];
  const first = view.getUint16(3, true);
  const count = view.getUint16(5, true);
  const colorDepth = indexed ? bytes[7] : depth;
  const supportedAlpha = colorDepth === 32 || (gray && depth === 16) ? [0, 8] : colorDepth === 16 ? [0, 1] : [0];
  if (!supportedAlpha.includes(alpha)) throw new BinaryPreviewError('unsupported');
  if (indexed) {
    if (!count || first + count > 65536 || ![15, 16, 24, 32].includes(bytes[7])) throw invalid();
    for (let index = 0; index < count; index++) palette.push(readColor(bytes[7]));
  }
  const pixel = () => {
    if (!indexed) return readColor(depth, gray);
    need(depth / 8);
    const index = depth === 8 ? bytes[cursor++] : bytes[cursor++] | (bytes[cursor++] << 8);
    if (!palette[index - first]) throw invalid();
    return palette[index - first];
  };
  const total = width * height;
  // RLE 每包最多 128 像素，连最小编码长度都不足时不分配展开缓冲区。
  need(kind >= 9 ? Math.ceil(total / 128) * (1 + Math.ceil(depth / 8)) : total * Math.ceil(depth / 8));
  const pixels = new Uint8Array(total * 4);
  let written = 0;
  const put = (color: number[]) => {
    const x = written % width;
    const y = Math.floor(written / width);
    const target = ((bytes[17] & 32 ? y : height - y - 1) * width + (bytes[17] & 16 ? width - x - 1 : x)) * 4;
    pixels.set(color, target);
    written++;
  };
  while (written < total) {
    if (kind < 9) put(pixel());
    else {
      need(1);
      const header = bytes[cursor++];
      const length = (header & 127) + 1;
      if (written + length > total) throw invalid();
      if (header & 128) {
        const color = pixel();
        for (let index = 0; index < length; index++) put(color);
      } else for (let index = 0; index < length; index++) put(pixel());
    }
  }
  return { width, height, pixels, orientation: 1 };
}
