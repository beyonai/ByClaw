/** 解码前限制输入，解码后再限制实际像素/字节，避免小文件展开后耗尽页面内存。 */
export const MAX_BINARY_PREVIEW_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_PAGES = 100;
export const MAX_IMAGE_PIXELS = 50 * 1000 * 1000;
export const MAX_ARCHIVE_ENTRIES = 1000;
export const MAX_ARCHIVE_TEXT_BYTES = 2 * 1024 * 1024;
export const PREVIEW_WORKER_TIMEOUT = 30_000;

export class BinaryPreviewError extends Error {
  constructor(public code: 'limit' | 'invalid' | 'unsupported' | 'timeout' | 'closed') {
    super(code);
  }
}

export interface DecodedImagePage {
  width: number;
  height: number;
  orientation: number;
  pixels: Uint8Array;
}

export interface ArchiveEntry {
  name: string;
  directory: boolean;
  previewable: boolean;
}

export interface PreviewOperations {
  openImage: { input: { buffer: ArrayBuffer; type: string }; output: number };
  imagePage: { input: { page: number }; output: DecodedImagePage };
  openZip: { input: { buffer: ArrayBuffer }; output: ArchiveEntry[] };
  zipEntry: { input: { name: string }; output: ArrayBuffer };
  readOds: { input: { buffer: ArrayBuffer }; output: import('./odsTypes').OdsSheet[] };
  openEpub: { input: { buffer: ArrayBuffer }; output: import('./epubTypes').EpubInfo };
  epubChapter: { input: { chapter: number }; output: string };
  epubImages: { input: { chapter: number; sources: string[] }; output: import('./epubTypes').EpubImage[] };
  openSqlite: { input: { buffer: ArrayBuffer }; output: import('./sqliteTypes').DatabaseInfo };
  sqlitePage: { input: { table: number; offset: number }; output: import('./sqliteTypes').DatabasePage };
}

export function validateImageSize(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new BinaryPreviewError('invalid');
  }
  if (width > 16384 || height > 16384 || width * height > MAX_IMAGE_PIXELS) {
    throw new BinaryPreviewError('limit');
  }
}

/** 预览限制长边为 4096，避免 4800 万像素照片在主线程同时占用多个全尺寸画布。 */
export function fitDecodedImage(page: DecodedImagePage): DecodedImagePage {
  const scale = Math.min(1, 4096 / Math.max(page.width, page.height));
  if (scale === 1) return page;
  const width = Math.max(1, Math.round(page.width * scale));
  const height = Math.max(1, Math.round(page.height * scale));
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const source = (Math.floor(y / scale) * page.width + Math.floor(x / scale)) * 4;
      const target = (y * width + x) * 4;
      pixels[target] = page.pixels[source];
      pixels[target + 1] = page.pixels[source + 1];
      pixels[target + 2] = page.pixels[source + 2];
      pixels[target + 3] = page.pixels[source + 3];
    }
  }
  return { ...page, width, height, pixels };
}
