/** @jest-environment node */
import { gzipSync } from 'zlib';
import { libarchiveWasm, type LibarchiveWasm } from 'libarchive-wasm';
import { openCompressedArchive } from './compressedArchiveDecoder';
import { MAX_ARCHIVE_TEXT_BYTES, MAX_BINARY_PREVIEW_BYTES } from './binaryPreview';
import { MAX_ARCHIVE_EXPANDED_BYTES } from './nativeArchiveDecoder';
import { tarFixture } from './fixtures/native-archive/tarFixture';

const gzip = (data: string | ArrayBuffer) =>
  new Uint8Array(gzipSync(typeof data === 'string' ? data : new Uint8Array(data))).buffer;

describe('GZIP and TGZ previews', () => {
  let lib: LibarchiveWasm;
  beforeAll(async () => {
    lib = await libarchiveWasm({ locateFile: () => require.resolve('libarchive-wasm/dist/libarchive.wasm') });
  });
  it('uses the original filename, previews decoded text and keeps a copy for reopening', async () => {
    const load = jest.fn();
    const input = gzip('姓名,数量\n测试,2');
    const before = input.slice(0);
    const archive = await openCompressedArchive(input, 'gz', '数据.CSV.GZ', load);
    expect(archive.entries).toEqual([{ name: '数据.CSV', directory: false, previewable: true }]);
    const first = await archive.extract('数据.CSV');
    expect(new TextDecoder().decode(first)).toBe('姓名,数量\n测试,2');
    new Uint8Array(first).fill(0);
    expect(new TextDecoder().decode(await archive.extract('数据.CSV'))).toContain('测试');
    expect(load).not.toHaveBeenCalled();
    expect(input).toEqual(before);
    await expect(archive.extract('missing.txt')).rejects.toMatchObject({ code: 'unsupported' });
  });
  it.each(['tgz', 'gz'] as const)('opens %s TAR directories and selected children', async (type) => {
    const source = tarFixture([
      { name: './', kind: '5' },
      { name: './docs/a.txt', text: 'hello' },
    ]);
    const archive = await openCompressedArchive(gzip(source), type, 'docs.tar.gz', async () => lib);
    expect(archive.entries).toEqual([{ name: 'docs/a.txt', directory: false, previewable: true }]);
    expect(new TextDecoder().decode(await archive.extract('docs/a.txt'))).toBe('hello');
  });
  it('uses gzip FNAME only when an outer .gz filename is absent', async () => {
    const compressed = new Uint8Array(gzip('hello'));
    const name = new TextEncoder().encode('report.txt\0');
    const named = new Uint8Array(compressed.length + name.length);
    named.set(compressed.subarray(0, 10));
    named[3] |= 8;
    named.set(name, 10);
    named.set(compressed.subarray(10), 10 + name.length);
    const archive = await openCompressedArchive(named.buffer, 'gz', undefined, jest.fn());
    expect(archive.entries[0].name).toBe('report.txt');
    expect(new TextDecoder().decode(await archive.extract('report.txt'))).toBe('hello');
  });
  it.each(['nested.zip.gz', 'unknown.gz'])('does not recursively preview or guess %s', async (name) => {
    const archive = await openCompressedArchive(gzip('data'), 'gz', name, jest.fn());
    expect(archive.entries[0].previewable).toBe(false);
    await expect(archive.extract(archive.entries[0].name)).rejects.toMatchObject({ code: 'unsupported' });
  });
  it('rejects damaged CRC, truncation, invalid headers and fake TAR content', async () => {
    const corrupt = new Uint8Array(gzip('hello'));
    corrupt[corrupt.length - 8] ^= 1;
    for (const bytes of [new ArrayBuffer(18), corrupt.buffer, gzip('hello').slice(0, -3)]) {
      await expect(openCompressedArchive(bytes, 'gz', 'a.txt.gz', jest.fn())).rejects.toMatchObject({
        code: 'invalid',
      });
    }
    await expect(openCompressedArchive(gzip('not tar'), 'tgz', 'a.tgz', async () => lib)).rejects.toMatchObject({
      code: 'invalid',
    });
  });
  it('rejects malformed optional headers before loading a decoder', async () => {
    const extra = new Uint8Array(gzip('hello'));
    extra[3] |= 4;
    extra[10] = 255;
    extra[11] = 255;
    const reserved = new Uint8Array(gzip('hello'));
    reserved[3] |= 0x80;
    const noTerminator = new Uint8Array(32).fill(65);
    noTerminator.set([0x1f, 0x8b, 8, 8]);
    const load = jest.fn();
    for (const source of [extra, reserved, noTerminator]) {
      await expect(openCompressedArchive(source.buffer, 'tgz', 'archive.tgz', load)).rejects.toMatchObject({
        code: 'invalid',
      });
    }
    expect(load).not.toHaveBeenCalled();
  });
  it('limits input and actual expanded text/TAR bytes', async () => {
    await expect(
      openCompressedArchive(new ArrayBuffer(MAX_BINARY_PREVIEW_BYTES + 1), 'gz', undefined, jest.fn())
    ).rejects.toMatchObject({ code: 'limit' });
    await expect(
      openCompressedArchive(gzip('x'.repeat(MAX_ARCHIVE_TEXT_BYTES + 1)), 'gz', 'a.txt.gz', jest.fn())
    ).rejects.toMatchObject({ code: 'limit' });
    await expect(
      openCompressedArchive(gzip(new ArrayBuffer(MAX_ARCHIVE_EXPANDED_BYTES + 1)), 'tgz', 'a.tgz', jest.fn())
    ).rejects.toMatchObject({ code: 'limit' });
  });
  it('reports unsupported when the browser has no streaming gzip decoder', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'DecompressionStream');
    Object.defineProperty(globalThis, 'DecompressionStream', { configurable: true, value: undefined });
    try {
      await expect(openCompressedArchive(gzip('hello'), 'gz', 'a.txt.gz', jest.fn())).rejects.toMatchObject({
        code: 'unsupported',
      });
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'DecompressionStream', descriptor);
      else Reflect.deleteProperty(globalThis, 'DecompressionStream');
    }
  });
});
