import { TextDecoder as NodeTextDecoder } from 'util';
import JSZip from 'jszip';
import { OFFICE_VARIANT_PREVIEW_TYPES } from './formats';
import { openArchive } from './archiveDecoder';
import { MAX_ARCHIVE_ENTRIES, MAX_ARCHIVE_TEXT_BYTES, MAX_BINARY_PREVIEW_BYTES } from './binaryPreview';

const encodeZip = (zip: JSZip, platform: 'DOS' | 'UNIX' = 'DOS') =>
  zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE', platform });

describe('ZIP directory and bounded on-demand extraction', () => {
  beforeAll(() => {
    Object.defineProperty(global, 'TextDecoder', { configurable: true, value: NodeTextDecoder });
  });

  it('lists Chinese paths and previews supported files while blocking nested archives and symlinks', async () => {
    const zip = new JSZip();
    zip.file('资料/表格.csv', '姓名,数量\n测试,2');
    zip.file('资料/照片.HEIC', new Uint8Array([1, 2, 3]));
    zip.file('nested.zip', 'zip');
    zip.file('nested.rar', 'rar');
    zip.file('nested.7z', '7z');
    zip.file('design.psd', 'psd');
    zip.file('link.txt', 'target', { unixPermissions: 0o120777 });
    const archive = await openArchive(await encodeZip(zip, 'UNIX'));
    expect(archive.entries).toEqual(
      expect.arrayContaining([
        { name: '资料/', directory: true, previewable: false },
        { name: '资料/表格.csv', directory: false, previewable: true },
        { name: '资料/照片.HEIC', directory: false, previewable: true },
        { name: 'nested.zip', directory: false, previewable: false },
        { name: 'link.txt', directory: false, previewable: false },
        { name: 'design.psd', directory: false, previewable: false },
      ])
    );
    expect(new NodeTextDecoder().decode(await archive.extract('资料/表格.csv'))).toBe('姓名,数量\n测试,2');
    await expect(archive.extract('nested.zip')).rejects.toMatchObject({ code: 'unsupported' });
    await expect(archive.extract('nested.rar')).rejects.toMatchObject({ code: 'unsupported' });
    await expect(archive.extract('nested.7z')).rejects.toMatchObject({ code: 'unsupported' });
    await expect(archive.extract('link.txt')).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('lists a highly compressed oversized file but stops when the extracted text exceeds the limit', async () => {
    const zip = new JSZip().file('large.txt', 'x'.repeat(MAX_ARCHIVE_TEXT_BYTES + 1)).file('small.txt', 'ok');
    const archive = await openArchive(await encodeZip(zip));
    await expect(archive.extract('large.txt')).rejects.toMatchObject({ code: 'limit' });
    expect(new NodeTextDecoder().decode(await archive.extract('small.txt'))).toBe('ok');
  });

  it('recognizes photo aliases inside ZIP and preserves the extracted bytes', async () => {
    const zip = new JSZip();
    const bytes = new Uint8Array([0xff, 0x0a, 0, 0]);
    const names = ['照片.JFIF', '照片.jpe', '照片.HIF', '照片.JXL'];
    names.forEach((name) => zip.file(name, bytes));
    zip.file('原片.CR3', bytes);
    const archive = await openArchive(await encodeZip(zip));
    for (const name of names) {
      expect(archive.entries).toContainEqual({ name, directory: false, previewable: true });
      expect(new Uint8Array(await archive.extract(name))).toEqual(bytes);
    }
    await expect(archive.extract('原片.CR3')).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('opens RTF and ODS children while preserving their original bytes', async () => {
    const zip = new JSZip();
    const bytes = new Uint8Array([0x7b, 0x5c, 0x72, 0x74, 0x66]);
    zip.file('正文.RTF', bytes).file('数据.ODS', bytes);
    const archive = await openArchive(await encodeZip(zip));
    expect(archive.entries).toEqual(
      expect.arrayContaining([
        { name: '正文.RTF', directory: false, previewable: true },
        { name: '数据.ODS', directory: false, previewable: true },
      ])
    );
    expect(new Uint8Array(await archive.extract('正文.RTF'))).toEqual(bytes);
    expect(new Uint8Array(await archive.extract('数据.ODS'))).toEqual(bytes);
  });

  it.each(['../escape.txt', '/absolute.txt', 'C:/drive.txt', 'folder/../../escape.txt', 'back\\slash.txt'])(
    'rejects unsafe archive path %s even when JSZip normalizes it',
    async (name) => {
      const zip = new JSZip().file(name, 'test', { createFolders: false });
      await expect(openArchive(await encodeZip(zip))).rejects.toMatchObject({ code: 'invalid' });
    }
  );

  it('rejects too many entries, oversized input and corrupt archives', async () => {
    const zip = new JSZip();
    for (let index = 0; index <= MAX_ARCHIVE_ENTRIES; index++) zip.file(`${index}.txt`, '');
    await expect(openArchive(await encodeZip(zip))).rejects.toMatchObject({ code: 'limit' });
    await expect(openArchive(new ArrayBuffer(MAX_BINARY_PREVIEW_BYTES + 1))).rejects.toMatchObject({ code: 'limit' });
    await expect(openArchive(new Uint8Array([1, 2, 3]).buffer)).rejects.toThrow();
  });

  it('preserves an empty ZIP as an empty directory', async () => {
    const archive = await openArchive(await encodeZip(new JSZip()));
    expect(archive.entries).toEqual([]);
  });
});

it.each([
  'book.epub',
  'data.sqlite',
  'data.db',
  'photo.dng',
  'photo.CR3',
  'report.odt',
  'slides.ODP',
  'analysis.ipynb',
  'mail.EML',
  ...OFFICE_VARIANT_PREVIEW_TYPES.map((type) => `file.${type}`),
])('allows %s inside ZIP through the shared renderer', async (name) => {
  const zip = new JSZip();
  zip.file(name, new Uint8Array([1, 2, 3]));
  const archive = await openArchive(await zip.generateAsync({ type: 'arraybuffer' }));
  expect(archive.entries).toContainEqual({ name, directory: false, previewable: true });
  expect(new Uint8Array(await archive.extract(name))).toEqual(new Uint8Array([1, 2, 3]));
});

it.each(['nested.tar', 'nested.tar.gz', 'nested.tgz', 'nested.txt.gz'])(
  'does not recursively preview %s',
  async (name) => {
    const archive = await openArchive(await encodeZip(new JSZip().file(name, 'data')));
    expect(archive.entries[0].previewable).toBe(false);
    await expect(archive.extract(name)).rejects.toMatchObject({ code: 'unsupported' });
  }
);
