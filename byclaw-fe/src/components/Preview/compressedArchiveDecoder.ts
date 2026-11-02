import { getPreviewExtension } from './formats';
import type { LibarchiveWasm } from 'libarchive-wasm';
import { BinaryPreviewError, MAX_BINARY_PREVIEW_BYTES, type ArchiveEntry } from './binaryPreview';
import { archiveEntryLimit, canPreviewArchiveName, isSafeArchivePath } from './archiveDecoder';
import { MAX_ARCHIVE_EXPANDED_BYTES, openExpandedTar } from './nativeArchiveDecoder';

export type CompressedArchiveType = 'gz' | 'tgz';

function gzipName(bytes: Uint8Array) {
  if (bytes.length < 18 || bytes[0] !== 0x1f || bytes[1] !== 0x8b || bytes[2] !== 8 || bytes[3] & 0xe0)
    throw new BinaryPreviewError('invalid');
  let offset = 10;
  const end = bytes.length - 8;
  if (bytes[3] & 4) {
    if (offset + 2 > end) throw new BinaryPreviewError('invalid');
    offset += 2 + (bytes[offset] | (bytes[offset + 1] << 8));
  }
  let name = '';
  for (const flag of [8, 16]) {
    if (!(bytes[3] & flag)) continue;
    const start = offset;
    while (offset < end && bytes[offset]) offset++;
    if (offset >= end) throw new BinaryPreviewError('invalid');
    if (flag === 8) {
      if (offset - start > 4096) throw new BinaryPreviewError('limit');
      name = new TextDecoder('iso-8859-1').decode(bytes.subarray(start, offset));
    }
    offset++;
  }
  if (bytes[3] & 2) offset += 2;
  if (offset >= end) throw new BinaryPreviewError('invalid');
  return name;
}

/** 流式读取并按实际输出计数，不信任 gzip 尾部可伪造/回绕的 ISIZE。 */
async function inflateGzip(buffer: ArrayBuffer, limit: number) {
  if (typeof DecompressionStream === 'undefined') throw new BinaryPreviewError('unsupported');
  const reader = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new BinaryPreviewError('limit');
      chunks.push(value);
    }
    const result = new Uint8Array(total);
    let offset = 0;
    chunks.forEach((chunk) => {
      result.set(chunk, offset);
      offset += chunk.length;
    });
    return result.buffer;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error instanceof BinaryPreviewError ? error : new BinaryPreviewError('invalid');
  } finally {
    reader.releaseLock();
  }
}

export async function openCompressedArchive(
  buffer: ArrayBuffer,
  type: CompressedArchiveType,
  fileName: string | undefined,
  loadTar: () => Promise<LibarchiveWasm>
) {
  if (buffer.byteLength > MAX_BINARY_PREVIEW_BYTES) throw new BinaryPreviewError('limit');
  const storedName = gzipName(new Uint8Array(buffer));
  // 外部文件名优先，兼容不保存 FNAME 的 gzip；无扩展名时不猜测内部格式。
  const outerName = fileName?.split(/[\\/]/).pop() || '';
  const name = /\.gz$/i.test(outerName) ? outerName.slice(0, -3) : storedName || 'content';
  if (!isSafeArchivePath(name) || name.length > 4096) throw new BinaryPreviewError('invalid');
  const tar = type === 'tgz' || /\.tar$/i.test(name);
  const expanded = await inflateGzip(buffer, tar ? MAX_ARCHIVE_EXPANDED_BYTES : archiveEntryLimit(name));
  if (tar) return openExpandedTar(expanded, await loadTar());
  const entries: ArchiveEntry[] = [
    { name, directory: false, previewable: !!getPreviewExtension(name) && canPreviewArchiveName(name) },
  ];
  return {
    entries,
    async extract(selected: string): Promise<ArrayBuffer> {
      if (selected !== name || !entries[0].previewable) throw new BinaryPreviewError('unsupported');
      // Worker 每次转移一份副本，返回列表后再次点击时缓存不会变成 detached buffer。
      return expanded.slice(0);
    },
  };
}
