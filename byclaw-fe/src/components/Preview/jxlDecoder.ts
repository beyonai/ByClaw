import { BinaryPreviewError, validateImageSize } from './binaryPreview';
import type { ImageDocument } from './imageDecoder';

const CONTAINER_SIGNATURE = [0, 0, 0, 12, 74, 88, 76, 32, 13, 10, 135, 10];

/** 只收集尺寸头所需的 11 字节，不展开容器元数据或复制整个压缩码流。 */
function codestreamPrefix(buffer: ArrayBuffer): Uint8Array {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0x0a) return bytes.subarray(0, 11);
  if (!CONTAINER_SIGNATURE.every((value, index) => bytes[index] === value)) {
    throw new BinaryPreviewError('invalid');
  }
  const view = new DataView(buffer);
  const prefix = new Uint8Array(11);
  let length = 0;
  let offset = CONTAINER_SIGNATURE.length;
  let kind: string | undefined;
  let nextPart = 0;
  let complete = false;
  while (offset < bytes.length) {
    if (bytes.length - offset < 8) throw new BinaryPreviewError('invalid');
    let size = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    let headerSize = 8;
    if (size === 1) {
      if (bytes.length - offset < 16) throw new BinaryPreviewError('invalid');
      size = view.getUint32(offset + 8) * 2 ** 32 + view.getUint32(offset + 12);
      headerSize = 16;
    } else if (size === 0) {
      size = bytes.length - offset;
    }
    if (!Number.isSafeInteger(size) || size < headerSize || size > bytes.length - offset) {
      throw new BinaryPreviewError('invalid');
    }
    let start = offset + headerSize;
    const end = offset + size;
    if (type === 'jxlc') {
      if (kind) throw new BinaryPreviewError('invalid');
      kind = type;
      complete = true;
    } else if (type === 'jxlp') {
      // 分段码流必须连续且只有一个末段；禁止校验一条码流却让解码器读取另一条。
      if (kind === 'jxlc' || complete || end - start < 4) throw new BinaryPreviewError('invalid');
      const part = view.getUint32(start);
      if ((part & 0x7fffffff) !== nextPart++) throw new BinaryPreviewError('invalid');
      complete = (part & 0x80000000) !== 0;
      kind = type;
      start += 4;
    }
    if (type === 'jxlc' || type === 'jxlp') {
      const count = Math.min(prefix.length - length, end - start);
      prefix.set(bytes.subarray(start, start + count), length);
      length += count;
    }
    offset = end;
  }
  if (!complete || !length) throw new BinaryPreviewError('invalid');
  return prefix.subarray(0, length);
}

/**
 * 在 WASM 分配像素前校验 JPEG XL SizeHeader（低位在前的 bitstream）。
 * 编码规则见 libjxl 的 SizeHeader::VisitFields：
 * https://github.com/libjxl/libjxl/blob/main/lib/jxl/headers.cc
 */
export function validateJxlDimensions(buffer: ArrayBuffer) {
  const bytes = codestreamPrefix(buffer);
  if (bytes[0] !== 0xff || bytes[1] !== 0x0a) throw new BinaryPreviewError('invalid');
  let bit = 16;
  const read = (count: number) => {
    if (bit + count > bytes.length * 8) throw new BinaryPreviewError('invalid');
    let value = 0;
    for (let index = 0; index < count; index++, bit++) {
      value += ((bytes[Math.floor(bit / 8)] >> bit % 8) & 1) * 2 ** index;
    }
    return value;
  };
  const small = read(1);
  const dimension = () => (small ? (read(5) + 1) * 8 : read([9, 13, 18, 30][read(2)]) + 1);
  const height = dimension();
  const ratio = read(3);
  const ratios = [
    [1, 1],
    [12, 10],
    [4, 3],
    [3, 2],
    [16, 9],
    [5, 4],
    [2, 1],
  ];
  const width = ratio ? Math.floor((height * ratios[ratio - 1][0]) / ratios[ratio - 1][1]) : dimension();
  validateImageSize(width, height);
  return { width, height };
}

export function openJxlDocument(buffer: ArrayBuffer): ImageDocument {
  const dimensions = validateJxlDimensions(buffer);
  let disposed = false;
  return {
    count: 1,
    async render(page) {
      if (disposed) throw new BinaryPreviewError('closed');
      if (page !== 0) throw new BinaryPreviewError('invalid');
      // 只加载单线程解码入口；不引入编码器，也不要求跨源隔离或 SharedArrayBuffer。
      const { default: decode } = await import('@jsquash/jxl/decode.js');
      if (disposed) throw new BinaryPreviewError('closed');
      const result = await decode(buffer);
      if (disposed) throw new BinaryPreviewError('closed');
      validateImageSize(result.width, result.height);
      // libjxl 已应用码流方向，输出宽高允许交换，但不能偏离已校验的画布。
      if (
        !(
          (result.width === dimensions.width && result.height === dimensions.height) ||
          (result.width === dimensions.height && result.height === dimensions.width)
        ) ||
        result.data.length !== result.width * result.height * 4
      ) {
        throw new BinaryPreviewError('invalid');
      }
      return {
        width: result.width,
        height: result.height,
        orientation: 1,
        // 使用独立的可转移缓冲区，避免把解码器持有的 WASM 内存交给主线程。
        pixels: new Uint8Array(result.data),
      };
    },
    dispose() {
      disposed = true;
    },
  };
}
