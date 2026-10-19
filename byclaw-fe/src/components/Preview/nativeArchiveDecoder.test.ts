/** @jest-environment node */
import { readFileSync } from 'fs';
import { join } from 'path';
import { libarchiveWasm, type LibarchiveWasm } from 'libarchive-wasm';
import { openNativeArchive, validateNativeArchive, MAX_ARCHIVE_EXPANDED_BYTES } from './nativeArchiveDecoder';
import { MAX_ARCHIVE_ENTRIES, MAX_ARCHIVE_TEXT_BYTES, MAX_BINARY_PREVIEW_BYTES } from './binaryPreview';
import { tarFixture } from './fixtures/native-archive/tarFixture';

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, 'fixtures/native-archive', name))).buffer;
const signature = () => {
  const bytes = new Uint8Array(32);
  bytes.set([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]);
  return bytes.buffer;
};

describe('real RAR/7z archives', () => {
  let lib: LibarchiveWasm;
  beforeAll(async () => {
    lib = await libarchiveWasm({ locateFile: () => require.resolve('libarchive-wasm/dist/libarchive.wasm') });
  });
  it.each(['v4.rar', 'v5.rar', 'lzma2.7z'])('lists and extracts %s without modifying the source', async (name) => {
    const source = fixture(name);
    const before = new Uint8Array(source).slice();
    const archive = openNativeArchive(source, name.endsWith('.7z') ? '7z' : 'rar', lib);
    const markdown = archive.entries.find((entry) => entry.name.endsWith('README.md'))!;
    expect(markdown.previewable).toBe(true);
    expect(new TextDecoder().decode(await archive.extract(markdown.name))).toContain('# example');
    const png = archive.entries.find((entry) => entry.name.endsWith('image.png'))!;
    expect(new Uint8Array(await archive.extract(png.name)).subarray(0, 8)).toEqual(
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    );
    // 单独重开读取，可重复点击同一个文件，转移上一份结果不会破坏内部源。
    expect(new TextDecoder().decode(await archive.extract(markdown.name))).toContain('# example');
    expect(new Uint8Array(source)).toEqual(before);
  });
  it('rejects encrypted archives and corrupted non-empty headers', () => {
    expect(() => openNativeArchive(fixture('v4-encrypted.rar'), 'rar', lib)).toThrow();
    const damaged = fixture('lzma2.7z');
    new Uint8Array(damaged)[12] ^= 0xff;
    expect(() => openNativeArchive(damaged, '7z', lib)).toThrow();
  });
  it('lists real TAR paths, skips its root and blocks links/nested archives', async () => {
    const input = tarFixture([
      { name: './', kind: '5' },
      { name: './docs/', kind: '5' },
      { name: './docs/a.txt', text: 'TAR 正文' },
      { name: 'hard.txt', kind: '1', link: './docs/a.txt' },
      { name: 'link.txt', kind: '2', link: './docs/a.txt' },
      { name: 'nested.tar.gz', text: 'not opened' },
    ]);
    const original = input.slice(0);
    const archive = openNativeArchive(input, 'tar', lib);
    expect(archive.entries.filter((entry) => entry.previewable).map((entry) => entry.name)).toEqual(['docs/a.txt']);
    expect(archive.entries[0]).toEqual({ name: 'docs/', directory: true, previewable: false });
    expect(new TextDecoder().decode(await archive.extract('docs/a.txt'))).toBe('TAR 正文');
    expect(new TextDecoder().decode(await archive.extract('docs/a.txt'))).toBe('TAR 正文');
    expect(input).toEqual(original);
    await expect(archive.extract('hard.txt')).rejects.toMatchObject({ code: 'unsupported' });
    expect(openNativeArchive(tarFixture([]), 'tar', lib).entries).toEqual([]);
  });
  it('rejects normalized TAR duplicates, traversal, bad checksums and truncated blocks', () => {
    expect(() => openNativeArchive(tarFixture([{ name: './a.txt' }, { name: 'a.txt' }]), 'tar', lib)).toThrow(
      'invalid'
    );
    expect(() => openNativeArchive(tarFixture([{ name: './../a.txt' }]), 'tar', lib)).toThrow('invalid');
    const bytes = tarFixture([{ name: 'a.txt', text: 'hello' }]);
    expect(() => validateNativeArchive(bytes.slice(0, -1), 'tar')).toThrow('invalid');
    new Uint8Array(bytes)[0] ^= 1;
    expect(() => validateNativeArchive(bytes, 'tar')).toThrow('invalid');
  });
});

type FakeEntry = { name: string; size?: number; kind?: number; encrypted?: boolean; hardlink?: string; bytes?: number };
function fakeLibrary(files: FakeEntry[], failAtEnd = false) {
  let index = -1;
  let remaining = 0;
  let cursor = 8;
  const module = {
    HEAP8: new Int8Array(256 * 1024),
    _malloc: jest.fn((size: number) => {
      const ptr = cursor;
      cursor += size;
      return ptr;
    }),
    _free: jest.fn(),
  };
  const lib = {
    module,
    read_new: jest.fn(() => {
      index = -1;
      cursor = 64;
      return 1;
    }),
    read_free: jest.fn(),
    read_support_filter_all: jest.fn(),
    read_support_format_all: jest.fn(),
    read_open_memory: jest.fn(),
    read_next_entry: jest.fn(() => {
      index++;
      remaining = files[index]?.bytes ?? files[index]?.size ?? 3;
      return index < files.length ? index + 1 : 0;
    }),
    error_string: jest.fn(() => (failAtEnd ? 'corrupt archive' : '')),
    entry_pathname: jest.fn(() => files[index].name),
    entry_size: jest.fn(() => files[index].size ?? 3),
    entry_filetype: jest.fn(() => files[index].kind ?? 0o100000),
    entry_is_encrypted: jest.fn(() => (files[index].encrypted ? 1 : 0)),
    entry_symlink: jest.fn(() => ''),
    entry_hardlink: jest.fn(() => files[index].hardlink || ''),
    read_has_encrypted_entries: jest.fn(() => 0),
    read_data_skip: jest.fn(),
    read_data: jest.fn((_, ptr: number, length: number) => {
      const count = Math.min(length, remaining);
      remaining -= count;
      module.HEAP8.fill(65, ptr, ptr + count);
      return count;
    }),
  };
  return { lib: lib as unknown as LibarchiveWasm, mocks: lib };
}
describe('native archive boundaries', () => {
  it('does not decompress files while listing and forbids nested archives and links', async () => {
    const { lib, mocks } = fakeLibrary([
      { name: 'data.csv' },
      { name: 'a.rar' },
      { name: 'b.7z' },
      { name: 'c.zip' },
      { name: 'link.txt', kind: 0o120000 },
      { name: 'hard.txt', hardlink: 'data.csv' },
    ]);
    const archive = openNativeArchive(signature(), '7z', lib);
    expect(mocks.read_data).not.toHaveBeenCalled();
    expect(archive.entries.filter((entry) => entry.previewable).map((entry) => entry.name)).toEqual(['data.csv']);
    await expect(archive.extract('a.rar')).rejects.toMatchObject({ code: 'unsupported' });
    expect(await archive.extract('data.csv')).toEqual(new Uint8Array([65, 65, 65]).buffer);
    expect(mocks.read_free).toHaveBeenCalledTimes(2);
  });
  it.each(['../escape.txt', '/absolute.txt', 'a\\b.txt', 'C:/drive.txt', 'bad\0.txt'])(
    'rejects unsafe path %s',
    (name) => {
      const { lib, mocks } = fakeLibrary([{ name }]);
      expect(() => openNativeArchive(signature(), '7z', lib)).toThrow('invalid');
      expect(mocks.read_free).toHaveBeenCalled();
      expect(mocks.module._free).toHaveBeenCalled();
    }
  );
  it('rejects duplicates, encryption, too many entries and excessive declared expansion', () => {
    for (const entries of [
      [{ name: 'a.txt' }, { name: 'a.txt' }],
      [{ name: 'a.txt', encrypted: true }],
      [{ name: 'a.txt', size: MAX_ARCHIVE_EXPANDED_BYTES + 1 }],
      Array.from({ length: MAX_ARCHIVE_ENTRIES + 1 }, (_, i) => ({ name: `${i}.txt`, size: 0 })),
    ])
      expect(() => openNativeArchive(signature(), '7z', fakeLibrary(entries).lib)).toThrow();
  });
  it('bounds actual bytes even when the declared size lies, and releases scratch allocations', async () => {
    const { lib, mocks } = fakeLibrary([{ name: 'a.txt', size: 1, bytes: MAX_ARCHIVE_TEXT_BYTES + 1 }]);
    const archive = openNativeArchive(signature(), '7z', lib);
    await expect(archive.extract('a.txt')).rejects.toMatchObject({ code: 'limit' });
    expect(mocks.read_free).toHaveBeenCalledTimes(2);
    expect(mocks.module._free).toHaveBeenCalledTimes(3);
  });
  it('rejects oversized declared files before reading and mismatched actual size afterward', async () => {
    const large = fakeLibrary([{ name: 'a.txt', size: MAX_ARCHIVE_TEXT_BYTES + 1 }]);
    await expect(openNativeArchive(signature(), '7z', large.lib).extract('a.txt')).rejects.toMatchObject({
      code: 'limit',
    });
    expect(large.mocks.read_data).not.toHaveBeenCalled();
    const truncated = fakeLibrary([{ name: 'a.txt', size: 3, bytes: 2 }]);
    await expect(openNativeArchive(signature(), '7z', truncated.lib).extract('a.txt')).rejects.toMatchObject({
      code: 'invalid',
    });
  });
  it('does not silently turn a decoder error into an empty listing', () => {
    expect(() => openNativeArchive(signature(), '7z', fakeLibrary([], true).lib)).toThrow('invalid');
  });
  it('checks signature, input size and RAR volume flags before loading WASM', () => {
    expect(() => validateNativeArchive(new ArrayBuffer(8), '7z')).toThrow('invalid');
    expect(() => validateNativeArchive(new ArrayBuffer(MAX_BINARY_PREVIEW_BYTES + 1), 'rar')).toThrow('limit');
    const rar4 = fixture('v4.rar');
    new Uint8Array(rar4)[10] |= 1;
    expect(() => validateNativeArchive(rar4, 'rar')).toThrow('unsupported');
    const rar5 = new Uint8Array([82, 97, 114, 33, 26, 7, 1, 0, 0, 0, 0, 0, 3, 1, 0, 1]);
    expect(() => validateNativeArchive(rar5.buffer, 'rar')).toThrow('unsupported');
  });
});
