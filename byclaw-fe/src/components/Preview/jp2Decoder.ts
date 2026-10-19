import { BinaryPreviewError, MAX_BINARY_PREVIEW_BYTES, validateImageSize } from './binaryPreview';
import type { ImageDocument } from './imageDecoder';

// 小波解码需要多份浮点缓冲区，JP2 使用比普通位图更低的像素上限。
export const MAX_JP2_PIXELS = 8_000_000;
const invalid = () => new BinaryPreviewError('invalid');
const unsupported = () => new BinaryPreviewError('unsupported');

/** 先检查 JP2 容器和码流头，再允许解码器按尺寸分配内存；不把 ICC/调色板误当 RGB。 */
export function inspectJp2(buffer: ArrayBuffer) {
  if (buffer.byteLength > MAX_BINARY_PREVIEW_BYTES) throw new BinaryPreviewError('limit');
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (
    bytes.length < 12 ||
    view.getUint32(0) !== 12 ||
    view.getUint32(4) !== 0x6a502020 ||
    view.getUint32(8) !== 0x0d0a870a
  )
    throw invalid();
  const metadata: {
    stream?: Uint8Array;
    dimensions?: { width: number; height: number; components: number };
    color: number;
  } = { color: 0 };
  let boxes = 0;
  const scan = (start: number, end: number, header = false) => {
    for (let offset = start; offset < end; ) {
      if (++boxes > 256) throw new BinaryPreviewError('limit');
      if (offset + 8 > end) throw invalid();
      let size = view.getUint32(offset);
      const type = view.getUint32(offset + 4);
      let prefix = 8;
      if (size === 1) {
        if (offset + 16 > end) throw invalid();
        size = view.getUint32(offset + 8) * 2 ** 32 + view.getUint32(offset + 12);
        prefix = 16;
      } else if (!size) size = end - offset;
      if (!Number.isSafeInteger(size) || size < prefix || offset + size > end) throw invalid();
      const data = offset + prefix;
      const length = size - prefix;
      if (type === 0x6a703268) {
        if (header || metadata.dimensions) throw invalid();
        scan(data, offset + size, true);
      } else if (type === 0x69686472 && header) {
        if (metadata.dimensions || length !== 14) throw invalid();
        metadata.dimensions = {
          height: view.getUint32(data),
          width: view.getUint32(data + 4),
          components: view.getUint16(data + 8),
        };
        if (bytes[data + 10] !== 7 || bytes[data + 11] !== 7) throw unsupported();
      } else if (type === 0x636f6c72 && header) {
        if (metadata.color || length !== 7 || bytes[data] !== 1) throw unsupported();
        metadata.color = view.getUint32(data + 3);
      } else if (type === 0x6a703263 && !header) {
        if (metadata.stream) throw unsupported();
        metadata.stream = bytes.subarray(data, offset + size);
      } else if (header && ![0x72657320].includes(type)) throw unsupported();
      offset += size;
    }
  };
  scan(12, bytes.length);
  const { dimensions, stream, color } = metadata;
  if (!dimensions || !stream) throw invalid();
  const { width, height, components } = dimensions;
  validateImageSize(width, height);
  if (width * height > MAX_JP2_PIXELS) throw new BinaryPreviewError('limit');
  if (!((components === 3 && color === 16) || (components === 1 && color === 17))) throw unsupported();
  const source: Uint8Array = stream;
  const data = new DataView(source.buffer, source.byteOffset, source.byteLength);
  if (source.length < 45 || data.getUint16(0) !== 0xff4f || data.getUint16(source.length - 2) !== 0xffd9)
    throw invalid();
  let offset = 2;
  let sized = false;
  let coding = false;
  let tiles = 0;
  let parts = 0;
  let tileEnd = 0;
  while (offset < source.length - 2) {
    const marker = data.getUint16(offset);
    offset += 2;
    if (marker === 0xff93) {
      if (!coding || tileEnd < offset) throw invalid();
      offset = tileEnd;
      tileEnd = 0;
      continue;
    }
    if (offset + 2 > source.length) throw invalid();
    const length = data.getUint16(offset);
    const end = offset + length;
    if (length < 2 || end > source.length - 2 || (tileEnd && end > tileEnd)) throw invalid();
    if (marker === 0xff51) {
      if (sized || offset !== 4 || length !== 38 + components * 3) throw invalid();
      if (
        data.getUint16(offset + 2) !== 0 ||
        data.getUint32(offset + 12) ||
        data.getUint32(offset + 16) ||
        data.getUint32(offset + 28) ||
        data.getUint32(offset + 32)
      )
        throw unsupported();
      if (
        data.getUint32(offset + 4) !== width ||
        data.getUint32(offset + 8) !== height ||
        data.getUint16(offset + 36) !== components
      )
        throw invalid();
      const tw = data.getUint32(offset + 20);
      const th = data.getUint32(offset + 24);
      validateImageSize(tw, th);
      tiles = Math.ceil(width / tw) * Math.ceil(height / th);
      if (tiles > 256) throw new BinaryPreviewError('limit');
      for (let index = offset + 38; index < end; index += 3) {
        if (source[index] !== 7 || source[index + 1] !== 1 || source[index + 2] !== 1) throw unsupported();
      }
      sized = true;
    } else if (marker === 0xff52) {
      if (!sized || length !== 12) throw unsupported();
      if (
        source[offset + 2] !== 0 ||
        source[offset + 3] > 4 ||
        !data.getUint16(offset + 4) ||
        data.getUint16(offset + 4) > 100 ||
        source[offset + 6] > 1 ||
        source[offset + 7] > 8 ||
        source[offset + 8] > 8 ||
        source[offset + 9] > 8 ||
        source[offset + 8] + source[offset + 9] > 8 ||
        source[offset + 10] !== 0 ||
        source[offset + 11] > 1
      )
        throw unsupported();
      coding = true;
    } else if (marker === 0xff90) {
      if (!sized || !coding || tileEnd || length !== 10 || data.getUint16(offset + 2) >= tiles) throw invalid();
      if (++parts > 1024) throw new BinaryPreviewError('limit');
      const size = data.getUint32(offset + 4);
      tileEnd = offset - 2 + size;
      if (size < 14 || tileEnd > source.length - 2) throw invalid();
    } else if (marker === 0xff5c) {
      if (!sized || length < 3 || length > 64 || (source[offset + 2] & 31) > 2) throw unsupported();
    } else if (marker !== 0xff64) throw unsupported();
    offset = end;
  }
  if (!sized || !coding || !parts || tileEnd || offset !== source.length - 2) throw invalid();
  return { width, height, components, source, tiles };
}

export async function openJp2Document(buffer: ArrayBuffer): Promise<ImageDocument> {
  const info = inspectJp2(buffer);
  const { JpxImage } = await import('jpeg2000');
  // jpeg2000 1.1.1 内部使用 Buffer 的大端读取接口；Worker 中用 DataView 适配，保留码流偏移和原始字节。
  const view = new DataView(info.source.buffer, info.source.byteOffset, info.source.byteLength);
  const source = Object.assign(info.source, {
    readUInt16BE: (offset: number) => view.getUint16(offset),
    readUInt32BE: (offset: number) => view.getUint32(offset),
  });
  let disposed = false;
  return {
    count: 1,
    async render(page) {
      if (disposed) throw new BinaryPreviewError('closed');
      if (page !== 0) throw invalid();
      const image = new JpxImage() as InstanceType<typeof JpxImage> & { failOnCorruptedImage: boolean };
      image.failOnCorruptedImage = true;
      image.parse(source);
      if (
        image.width !== info.width ||
        image.height !== info.height ||
        image.componentsCount !== info.components ||
        image.tiles.length !== info.tiles
      )
        throw invalid();
      const pixels = new Uint8Array(info.width * info.height * 4);
      let total = 0;
      const seen: typeof image.tiles = [];
      for (const tile of image.tiles) {
        const { left, top, width, height, items } = tile;
        validateImageSize(width, height);
        if (
          !Number.isInteger(left) ||
          !Number.isInteger(top) ||
          left < 0 ||
          top < 0 ||
          left + width > info.width ||
          top + height > info.height ||
          items.length !== width * height * info.components
        )
          throw invalid();
        if (
          seen.some(
            (other) =>
              left < other.left + other.width &&
              left + width > other.left &&
              top < other.top + other.height &&
              top + height > other.top
          )
        )
          throw invalid();
        seen.push(tile);
        total += width * height;
        for (let y = 0; y < height; y++)
          for (let x = 0; x < width; x++) {
            const source = (y * width + x) * info.components;
            const target = ((top + y) * info.width + left + x) * 4;
            pixels[target] = items[source];
            pixels[target + 1] = items[source + (info.components === 3 ? 1 : 0)];
            pixels[target + 2] = items[source + (info.components === 3 ? 2 : 0)];
            pixels[target + 3] = 255;
          }
      }
      if (total !== info.width * info.height) throw invalid();
      return { width: info.width, height: info.height, pixels, orientation: 1 };
    },
    dispose() {
      disposed = true;
    },
  };
}
