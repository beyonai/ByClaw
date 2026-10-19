export const MAX_EPUB_CHAPTERS = 500;
export const MAX_EPUB_XML_BYTES = 2 * 1024 * 1024;
export const MAX_EPUB_IMAGES = 32;
export const MAX_EPUB_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_EPUB_CHAPTER_IMAGE_BYTES = 8 * 1024 * 1024;

export interface EpubInfo {
  title: string;
  chapters: { name: string }[];
}

export interface EpubImage {
  source: string;
  mime: string;
  buffer: ArrayBuffer;
}
