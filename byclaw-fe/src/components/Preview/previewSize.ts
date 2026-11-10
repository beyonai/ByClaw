/** 原文件上限按十进制 MB 计算，解压等内部预算在各解码器中单独定义。 */
export const BYTES_PER_MB = 1_000_000;
export const DEFAULT_PREVIEW_BYTES = 50 * BYTES_PER_MB;
export const LARGE_PREVIEW_BYTES = 100 * BYTES_PER_MB;
export const MAX_ARCHIVE_PREVIEW_BYTES = LARGE_PREVIEW_BYTES;
export const LARGE_TEXT_SOURCE_BYTES = BYTES_PER_MB;
export const DEFER_HTML_SOURCE_BYTES = 10 * BYTES_PER_MB;
