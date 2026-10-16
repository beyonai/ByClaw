import { RAW_PREVIEW_TYPES } from './formats';
import {
  BinaryPreviewError,
  MAX_BINARY_PREVIEW_BYTES,
  MAX_IMAGE_PAGES,
  validateImageSize,
  type DecodedImagePage,
} from './binaryPreview';

export interface ImageDocument {
  count: number;
  render(page: number): Promise<DecodedImagePage>;
  dispose(): void;
}

const checkPage = (page: number, count: number) => {
  if (!Number.isInteger(page) || page < 0 || page >= count) throw new BinaryPreviewError('invalid');
};

export async function openImageDocument(buffer: ArrayBuffer, type: string): Promise<ImageDocument> {
  if (RAW_PREVIEW_TYPES.includes(type)) {
    const { openRawDocument } = await import('./rawDecoder');
    return openRawDocument(buffer);
  }
  if (!buffer.byteLength) throw new BinaryPreviewError('invalid');
  if (buffer.byteLength > MAX_BINARY_PREVIEW_BYTES) throw new BinaryPreviewError('limit');

  if (type === 'jxl') {
    const { openJxlDocument } = await import('./jxlDecoder');
    return openJxlDocument(buffer);
  }

  if (type === 'tif' || type === 'tiff') {
    const header = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
    if (
      !(
        (header[0] === 73 && header[1] === 73 && header[2] === 42 && header[3] === 0) ||
        (header[0] === 77 && header[1] === 77 && header[2] === 0 && header[3] === 42)
      )
    ) {
      throw new BinaryPreviewError('invalid');
    }
    const { default: UTIF } = await import('utif');
    const pages = UTIF.decode(buffer);
    if (!pages.length) throw new BinaryPreviewError('invalid');
    if (pages.length > MAX_IMAGE_PAGES) throw new BinaryPreviewError('limit');
    pages.forEach((page) => {
      validateImageSize(page.t256?.[0], page.t257?.[0]);
      // UTIF 对未知压缩/分平面布局只打印日志，会返回空白或错误颜色，必须明确拒绝。
      const compression = page.t259?.[0] || 1;
      if (![1, 3, 4, 5, 6, 7, 8, 32773, 32809, 32946].includes(compression) || page.t284?.[0] === 2) {
        throw new BinaryPreviewError('unsupported');
      }
      if (compression === 32946) page.t259 = [8];
      const bits: number[] = page.t258 || [1];
      const photometric = page.t262?.[0] ?? 2;
      const supportedBits: Record<number, number[]> = {
        0: [1, 4, 8],
        1: [1, 2, 8, 16],
        2: [8, 16],
        3: [8],
        5: [8],
        6: [8],
      };
      if (
        !supportedBits[photometric]?.includes(bits[0]) ||
        bits.some((value) => value !== bits[0]) ||
        bits.length > 5 ||
        (photometric === 6 && compression !== 6 && compression !== 7)
      ) {
        throw new BinaryPreviewError('unsupported');
      }
      const bytesPerPixel = bits.reduce((sum, value) => sum + value, 0) / 8;
      const allocation = page.t256[0] * page.t257[0] * bytesPerPixel;
      const tileAllocation = (page.t322?.[0] || 0) * (page.t323?.[0] || 0) * bytesPerPixel;
      if (!Number.isFinite(tileAllocation) || allocation > 256 * 1024 * 1024 || tileAllocation > 256 * 1024 * 1024) {
        throw new BinaryPreviewError('limit');
      }
    });
    return {
      count: pages.length,
      async render(index) {
        checkPage(index, pages.length);
        const page = pages[index];
        try {
          // 只解码当前页，不同时保留多页扫描件的展开像素。
          UTIF.decodeImage(buffer, page, pages);
          const pixels = UTIF.toRGBA8(page);
          const width = page.t256[0];
          const height = page.t257[0];
          if (pixels.length !== width * height * 4) throw new BinaryPreviewError('invalid');
          return { width, height, orientation: page.t274?.[0] || 1, pixels };
        } finally {
          delete page.data;
        }
      },
      dispose() {
        pages.length = 0;
      },
    };
  }

  if (type !== 'heic' && type !== 'heif') throw new BinaryPreviewError('unsupported');
  const { default: initialize } = await import('libheif-js/libheif-wasm/libheif-bundle.mjs');
  const codec = await initialize();
  const images = new codec.HeifDecoder().decode(new Uint8Array(buffer));
  const count = images.length;
  let disposed = false;
  try {
    if (!images.length) throw new BinaryPreviewError('invalid');
    if (images.length > MAX_IMAGE_PAGES) throw new BinaryPreviewError('limit');
    images.forEach((image) => validateImageSize(image.get_width(), image.get_height()));
  } finally {
    images.forEach((image) => image.free());
  }
  return {
    count,
    async render(index) {
      if (disposed) throw new BinaryPreviewError('closed');
      checkPage(index, count);
      // 重新打开句柄以避免 libheif 的 image 对象缓存每个访问过的页面像素。
      const pageImages = new codec.HeifDecoder().decode(new Uint8Array(buffer));
      try {
        const image = pageImages[index];
        if (!image) throw new BinaryPreviewError('invalid');
        const width = image.get_width();
        const height = image.get_height();
        validateImageSize(width, height);
        const target = { width, height, data: new Uint8ClampedArray(width * height * 4) };
        const result = await new Promise<typeof target>((resolve, reject) => {
          image.display(target, (decoded) => (decoded ? resolve(decoded) : reject(new BinaryPreviewError('invalid'))));
        });
        if (result.data.length !== width * height * 4) throw new BinaryPreviewError('invalid');
        // libheif 已处理 HEIF 的旋转/镜像；不能再套用 TIFF 的方向标记。
        return { width, height, orientation: 1, pixels: new Uint8Array(result.data.buffer) };
      } finally {
        pageImages.forEach((image) => image.free());
      }
    },
    dispose() {
      disposed = true;
    },
  };
}
