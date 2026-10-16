import JSZip from 'jszip';
import { readZipEntry } from './readZipEntry';
import {
  BinaryPreviewError,
  MAX_ARCHIVE_ENTRIES,
  MAX_ARCHIVE_TEXT_BYTES,
  MAX_BINARY_PREVIEW_BYTES,
  type ArchiveEntry,
} from './binaryPreview';
import {
  ARCHIVE_PREVIEW_TYPES,
  HTML_PREVIEW_TYPES,
  TEXT_PREVIEW_TYPES,
  isPreviewableName,
  resolvePreviewType,
} from './formats';

export const isSafeArchivePath = (name: string) =>
  !!name &&
  !/[\x00-\x1f\\]/.test(name) &&
  !name.startsWith('/') &&
  !/^[a-z]:/i.test(name) &&
  !name.split('/').some((part) => part === '..' || part === '.');

// 所有压缩格式共享嵌套限制，避免新增 RAR/7z 后从 ZIP 子文件入口递归解压。
export const canPreviewArchiveName = (name: string) =>
  isPreviewableName(name) && !ARCHIVE_PREVIEW_TYPES.includes(resolvePreviewType(undefined, name));

export function archiveEntryLimit(name: string) {
  const type = resolvePreviewType(undefined, name);
  return [...TEXT_PREVIEW_TYPES, ...HTML_PREVIEW_TYPES, 'md', 'svg'].includes(type)
    ? MAX_ARCHIVE_TEXT_BYTES
    : MAX_BINARY_PREVIEW_BYTES;
}

export function canPreviewArchiveEntry(entry: JSZip.JSZipObject) {
  const permissions = Number(entry.unixPermissions || 0);
  return !entry.dir && (permissions & 0xf000) !== 0xa000 && canPreviewArchiveName(entry.name);
}

/** 旧 Windows ZIP 未设置 UTF-8 标记时，用 GB18030 保留中文文件名。 */
const decodeFileName = (bytes: string[] | Uint8Array) => {
  const data = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes, (value) => value.charCodeAt(0));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    return new TextDecoder('gb18030').decode(data);
  }
};

export async function openArchive(buffer: ArrayBuffer) {
  if (!buffer.byteLength) throw new BinaryPreviewError('invalid');
  if (buffer.byteLength > MAX_BINARY_PREVIEW_BYTES) throw new BinaryPreviewError('limit');
  // 不开启 checkCRC32：它会在列目录时解压全部文件，破坏按需解压的内存边界。
  const zip = await JSZip.loadAsync(buffer, { decodeFileName });
  const files = Object.values(zip.files);
  if (files.length > MAX_ARCHIVE_ENTRIES) throw new BinaryPreviewError('limit');
  if (
    files.some((entry) => !isSafeArchivePath(entry.name) || !isSafeArchivePath(entry.unsafeOriginalName || entry.name))
  ) {
    throw new BinaryPreviewError('invalid');
  }
  const entries: ArchiveEntry[] = files.map((entry) => ({
    name: entry.name,
    directory: entry.dir,
    previewable: canPreviewArchiveEntry(entry),
  }));
  entries.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
  return {
    entries,
    async extract(name: string): Promise<ArrayBuffer> {
      const entry = zip.files[name];
      if (!entry || !canPreviewArchiveEntry(entry)) throw new BinaryPreviewError('unsupported');
      return readZipEntry(entry, archiveEntryLimit(name));
    },
  };
}
