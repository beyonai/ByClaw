import type { LibarchiveWasm } from 'libarchive-wasm';
import { BinaryPreviewError, MAX_ARCHIVE_ENTRIES, MAX_BINARY_PREVIEW_BYTES, type ArchiveEntry } from './binaryPreview';
import { archiveEntryLimit, canPreviewArchiveName, isSafeArchivePath } from './archiveDecoder';

export type NativeArchiveType = 'rar' | '7z' | 'tar';
export const MAX_ARCHIVE_EXPANDED_BYTES = 50 * 1024 * 1024;
const CHUNK_BYTES = 64 * 1024;

/** TAR 没有固定魔数（旧格式也有效），用首块校验和排除误标文件。 */
export function validateTar(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 1024 || bytes.length % 512) throw new BinaryPreviewError('invalid');
  const header = bytes.subarray(0, 512);
  if (header.every((byte) => byte === 0)) {
    if (!bytes.every((byte) => byte === 0)) throw new BinaryPreviewError('invalid');
    return;
  }
  const checksum = String.fromCharCode(...header.subarray(148, 156))
    .replace(/\0/g, '')
    .trim();
  if (!/^[0-7]+$/.test(checksum)) throw new BinaryPreviewError('invalid');
  let unsigned = 0;
  let signed = 0;
  header.forEach((byte, index) => {
    const value = index >= 148 && index < 156 ? 32 : byte;
    unsigned += value;
    signed += value > 127 ? value - 256 : value;
  });
  if (![unsigned, signed].includes(parseInt(checksum, 8))) throw new BinaryPreviewError('invalid');
}

/** 先校验签名；RAR 分卷/加密头不能作为普通单文件目录展示。 */
export function validateNativeArchive(buffer: ArrayBuffer, type: NativeArchiveType) {
  if (!buffer.byteLength) throw new BinaryPreviewError('invalid');
  if (buffer.byteLength > MAX_BINARY_PREVIEW_BYTES) throw new BinaryPreviewError('limit');
  if (type === 'tar') return validateTar(buffer);
  const bytes = new Uint8Array(buffer);
  const starts = (values: number[]) => values.every((byte, index) => bytes[index] === byte);
  if (type === '7z') {
    if (bytes.length < 32 || !starts([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) throw new BinaryPreviewError('invalid');
    return;
  }
  if (type !== 'rar' || !starts([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])) throw new BinaryPreviewError('invalid');
  if (bytes[6] === 0) {
    if (bytes.length < 20 || bytes[9] !== 0x73) throw new BinaryPreviewError('invalid');
    const flags = bytes[10] | (bytes[11] << 8);
    if (flags & (0x01 | 0x80)) throw new BinaryPreviewError('unsupported');
  } else if (bytes[6] === 1 && bytes[7] === 0) {
    let offset = 12;
    const vint = () => {
      let value = 0;
      let scale = 1;
      for (let i = 0; i < 8 && offset < bytes.length; i++) {
        const byte = bytes[offset++];
        value += (byte & 127) * scale;
        if (!Number.isSafeInteger(value)) throw new BinaryPreviewError('invalid');
        if (!(byte & 128)) return value;
        scale *= 128;
      }
      throw new BinaryPreviewError('invalid');
    };
    const size = vint();
    const end = offset + size;
    const headerType = vint();
    if (headerType === 4) throw new BinaryPreviewError('unsupported');
    if (headerType !== 1 || end > bytes.length) throw new BinaryPreviewError('invalid');
    const flags = vint();
    if (flags & 1) vint();
    if (flags & 2) vint();
    if (vint() & 1) throw new BinaryPreviewError('unsupported');
    if (offset > end) throw new BinaryPreviewError('invalid');
  } else throw new BinaryPreviewError('invalid');
}

function openArchiveContents(buffer: ArrayBuffer, lib: LibarchiveWasm, tarPaths: boolean) {
  const module = lib.module;
  const scan = (selected?: string) => {
    let input = 0;
    let archive = 0;
    let scratch = 0;
    const entries: ArchiveEntry[] = [];
    const names = new Set<string>();
    let declaredTotal = 0;
    let scanned = 0;
    try {
      input = module._malloc(buffer.byteLength);
      if (!input) throw new BinaryPreviewError('limit');
      module.HEAP8.set(new Int8Array(buffer), input);
      archive = lib.read_new();
      if (!archive) throw new BinaryPreviewError('invalid');
      lib.read_support_filter_all(archive);
      lib.read_support_format_all(archive);
      lib.read_open_memory(archive, input, buffer.byteLength);
      for (;;) {
        const pointer = lib.read_next_entry(archive);
        if (!pointer) {
          // 上游把 EOF 和解码错误都转换成空指针，必须再检查错误，避免把损坏包当空目录。
          if (lib.error_string(archive)) throw new BinaryPreviewError('invalid');
          break;
        }
        if (++scanned > MAX_ARCHIVE_ENTRIES) throw new BinaryPreviewError('limit');
        const originalName = lib.entry_pathname(pointer);
        if (!originalName || originalName.length > 4096) throw new BinaryPreviewError('invalid');
        const filetype = lib.entry_filetype(pointer);
        // tar -cf archive.tar . 会产生根目录及 ./ 前缀；只移除前缀，不放宽内部路径校验。
        const name = tarPaths ? originalName.replace(/^(?:\.\/)+/, '') : originalName;
        if (lib.entry_is_encrypted(pointer)) throw new BinaryPreviewError('unsupported');
        const size = lib.entry_size(pointer);
        if (!Number.isSafeInteger(size) || size < 0) throw new BinaryPreviewError('invalid');
        declaredTotal += size;
        if (declaredTotal > MAX_ARCHIVE_EXPANDED_BYTES) throw new BinaryPreviewError('limit');
        if (tarPaths && (!name || name === '.') && filetype === 0o040000) {
          lib.read_data_skip(archive);
          continue;
        }
        if (!isSafeArchivePath(name) || names.has(name)) throw new BinaryPreviewError('invalid');
        names.add(name);
        const directory = filetype === 0o040000;
        const regular = filetype === 0o100000 && !lib.entry_symlink(pointer) && !lib.entry_hardlink(pointer);
        const previewable = regular && canPreviewArchiveName(name);
        entries.push({ name, directory, previewable });
        if (name === selected) {
          if (!previewable) throw new BinaryPreviewError('unsupported');
          const limit = archiveEntryLimit(name);
          if (size > limit) throw new BinaryPreviewError('limit');
          scratch = module._malloc(CHUNK_BYTES);
          if (!scratch) throw new BinaryPreviewError('limit');
          const chunks: Uint8Array[] = [];
          let total = 0;
          for (;;) {
            const count = lib.read_data(archive, scratch, CHUNK_BYTES);
            if (!Number.isInteger(count) || count < 0 || count > CHUNK_BYTES) throw new BinaryPreviewError('invalid');
            if (!count) break;
            total += count;
            if (total > limit) throw new BinaryPreviewError('limit');
            chunks.push(new Uint8Array(module.HEAP8.buffer, scratch, count).slice());
          }
          if (total !== size) throw new BinaryPreviewError('invalid');
          const result = new Uint8Array(total);
          let offset = 0;
          chunks.forEach((chunk) => {
            result.set(chunk, offset);
            offset += chunk.length;
          });
          return { entries, buffer: result.buffer };
        }
        lib.read_data_skip(archive);
      }
      if (lib.read_has_encrypted_entries(archive) > 0) throw new BinaryPreviewError('unsupported');
      if (selected !== undefined) throw new BinaryPreviewError('unsupported');
      return { entries, buffer: undefined };
    } finally {
      // 解析、解压、分配任一步失败也释放原生句柄；关闭面板另由 worker terminate 回收堆。
      try {
        if (archive) lib.read_free(archive);
      } finally {
        if (scratch) module._free(scratch);
        if (input) module._free(input);
      }
    }
  };
  const entries = scan().entries;
  entries.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
  return {
    entries,
    async extract(name: string): Promise<ArrayBuffer> {
      if (!entries.some((entry) => entry.name === name && entry.previewable))
        throw new BinaryPreviewError('unsupported');
      return scan(name).buffer!;
    },
  };
}

/** 在独占 Worker 中遍历目录，点选后重新打开；不使用一次性分配声明大小的 readData()。 */
export function openNativeArchive(buffer: ArrayBuffer, type: NativeArchiveType, lib: LibarchiveWasm) {
  validateNativeArchive(buffer, type);
  return openArchiveContents(buffer, lib, type === 'tar');
}

/** 仅供经过流式解压限额的 TGZ 使用，原始上传仍限制为 20 MiB。 */
export function openExpandedTar(buffer: ArrayBuffer, lib: LibarchiveWasm) {
  if (buffer.byteLength > MAX_ARCHIVE_EXPANDED_BYTES) throw new BinaryPreviewError('limit');
  validateTar(buffer);
  return openArchiveContents(buffer, lib, true);
}
