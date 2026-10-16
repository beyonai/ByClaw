import { openEpub } from './epubDecoder';
import { openSqlite, validateSqlite } from './sqliteDecoder';
import { loadSqlite } from './loadSqlite';
import { decodeOpenDocument } from './openDocumentDecoder';
import { decodeNotebook } from './notebookDecoder';
import { BinaryPreviewError } from './binaryPreview';
import { decodeEml } from './emlDecoder';
import { prepareOfficeVariant } from './officeVariantDecoder';
import { decodeMsg } from './msgDecoder';
import { openNativeArchive, validateNativeArchive } from './nativeArchiveDecoder';
import { loadArchive } from './loadArchive';
import { openCompressedArchive } from './compressedArchiveDecoder';

jest.mock('./epubDecoder', () => ({ openEpub: jest.fn() }));
jest.mock('./sqliteDecoder', () => ({ openSqlite: jest.fn(), validateSqlite: jest.fn() }));
jest.mock('./loadSqlite', () => ({ loadSqlite: jest.fn() }));
jest.mock('./openDocumentDecoder', () => ({ decodeOpenDocument: jest.fn() }));
jest.mock('./notebookDecoder', () => ({ decodeNotebook: jest.fn() }));
jest.mock('./emlDecoder', () => ({ decodeEml: jest.fn() }));
jest.mock('./officeVariantDecoder', () => ({ prepareOfficeVariant: jest.fn() }));
jest.mock('./msgDecoder', () => ({ decodeMsg: jest.fn() }));
jest.mock('./nativeArchiveDecoder', () => ({ openNativeArchive: jest.fn(), validateNativeArchive: jest.fn() }));
jest.mock('./loadArchive', () => ({ loadArchive: jest.fn() }));
jest.mock('./compressedArchiveDecoder', () => ({ openCompressedArchive: jest.fn() }));

describe('ebook and database worker operations', () => {
  let previousHandler: typeof self.onmessage;
  let previousPost: typeof self.postMessage;
  let post: jest.Mock;
  beforeAll(async () => {
    previousHandler = self.onmessage;
    previousPost = self.postMessage;
    post = jest.fn();
    self.postMessage = post;
    await import('./preview.worker');
  });
  afterAll(() => {
    self.onmessage = previousHandler;
    self.postMessage = previousPost;
  });
  const request = async (operation: string, input: unknown) => {
    await (self.onmessage as any)({ data: { id: 1, operation, input } });
    return post.mock.calls[post.mock.calls.length - 1];
  };
  it('validates archives before loading WASM and transfers extracted data', async () => {
    const input = new ArrayBuffer(32);
    const output = new ArrayBuffer(3);
    const document = {
      entries: [{ name: 'one.txt', directory: false, previewable: true }],
      extract: jest.fn(async () => output),
    };
    (loadArchive as jest.Mock).mockResolvedValue({});
    (openNativeArchive as jest.Mock).mockReturnValue(document);
    expect((await request('openNativeArchive', { buffer: input, type: '7z' }))[0]).toEqual({
      id: 1,
      result: document.entries,
    });
    expect(validateNativeArchive).toHaveBeenCalledWith(input, '7z');
    expect(await request('zipEntry', { name: 'one.txt' })).toEqual([{ id: 1, result: output }, [output]]);
    (validateNativeArchive as jest.Mock).mockImplementationOnce(() => {
      throw new BinaryPreviewError('unsupported');
    });
    (loadArchive as jest.Mock).mockClear();
    expect((await request('openNativeArchive', { buffer: input, type: 'rar' }))[0]).toEqual({
      id: 1,
      error: 'unsupported',
    });
    expect(loadArchive).not.toHaveBeenCalled();
    expect((await request('zipEntry', { name: 'one.txt' }))[0]).toEqual({ id: 1, error: 'invalid' });
  });
  it('routes gzip filenames and clears old entries after a failed replacement', async () => {
    const buffer = new ArrayBuffer(32);
    const output = new ArrayBuffer(4);
    const entries = [{ name: 'a.txt', directory: false, previewable: true }];
    (openCompressedArchive as jest.Mock).mockResolvedValueOnce({ entries, extract: async () => output });
    expect((await request('openCompressedArchive', { buffer, type: 'gz', fileName: 'a.txt.gz' }))[0]).toEqual({
      id: 1,
      result: entries,
    });
    expect(openCompressedArchive).toHaveBeenCalledWith(buffer, 'gz', 'a.txt.gz', expect.any(Function));
    expect(await request('zipEntry', { name: 'a.txt' })).toEqual([{ id: 1, result: output }, [output]]);
    (openCompressedArchive as jest.Mock).mockRejectedValueOnce(new BinaryPreviewError('invalid'));
    expect((await request('openCompressedArchive', { buffer, type: 'tgz' }))[0]).toEqual({ id: 1, error: 'invalid' });
    expect((await request('zipEntry', { name: 'a.txt' }))[0]).toEqual({ id: 1, error: 'invalid' });
  });
  it('transfers MSG RTF and attachments and reports parser errors', async () => {
    const attachment = new ArrayBuffer(3);
    const rtf = new ArrayBuffer(43);
    const email = { subject: 'MSG', rtf, attachments: [{ buffer: attachment }] };
    (decodeMsg as jest.Mock).mockReturnValueOnce(email).mockImplementationOnce(() => {
      throw new BinaryPreviewError('limit');
    });
    expect(await request('readMsg', { buffer: new ArrayBuffer(8) })).toEqual([
      { id: 1, result: email },
      [rtf, attachment],
    ]);
    expect((await request('readMsg', { buffer: new ArrayBuffer(8) }))[0]).toEqual({ id: 1, error: 'limit' });
  });
  it('transfers prepared Office copies and decoded EML attachments', async () => {
    const input = new ArrayBuffer(8);
    const prepared = new ArrayBuffer(4);
    (prepareOfficeVariant as jest.Mock).mockResolvedValue(prepared);
    expect(await request('prepareOfficeVariant', { buffer: input, type: 'docm' })).toEqual([
      { id: 1, result: prepared },
      [prepared],
    ]);
    expect(prepareOfficeVariant).toHaveBeenCalledWith(input, 'docm');
    const attachment = new ArrayBuffer(3);
    const email = { subject: 'mail', attachments: [{ buffer: attachment }] };
    (decodeEml as jest.Mock).mockResolvedValue(email);
    expect(await request('readEml', { buffer: input })).toEqual([{ id: 1, result: email }, [attachment]]);
  });
  it('routes ODT/ODP and notebook decoding and serializes decoder failures', async () => {
    const buffer = new ArrayBuffer(10);
    const document = { pages: [{ name: '', html: '<p>body</p>' }], omitted: false };
    (decodeOpenDocument as jest.Mock).mockResolvedValue(document);
    expect((await request('readOpenDocument', { buffer, type: 'odt' }))[0]).toEqual({ id: 1, result: document });
    expect(decodeOpenDocument).toHaveBeenCalledWith(buffer, 'odt');
    await request('readOpenDocument', { buffer, type: 'odp' });
    expect(decodeOpenDocument).toHaveBeenLastCalledWith(buffer, 'odp');
    const notebook = { cells: [], omitted: false };
    (decodeNotebook as jest.Mock).mockReturnValueOnce(notebook).mockImplementationOnce(() => {
      throw new BinaryPreviewError('limit');
    });
    expect((await request('readNotebook', { buffer }))[0]).toEqual({ id: 1, result: notebook });
    expect((await request('readNotebook', { buffer }))[0]).toEqual({ id: 1, error: 'limit' });
  });
  it('routes chapter and image requests and transfers extracted image buffers', async () => {
    const info = { title: 'book', chapters: [{ name: 'one' }] };
    const buffer = new ArrayBuffer(3);
    const images = [{ source: 'a.png', mime: 'image/png', buffer }];
    const readChapter = jest.fn(async () => '<p>chapter</p>');
    const readImages = jest.fn(async () => images);
    (openEpub as jest.Mock).mockResolvedValue({ info, readChapter, readImages });
    expect((await request('openEpub', { buffer: new ArrayBuffer(10) }))[0]).toEqual({ id: 1, result: info });
    expect((await request('epubChapter', { chapter: 0 }))[0].result).toBe('<p>chapter</p>');
    expect(await request('epubImages', { chapter: 0, sources: ['a.png'] })).toEqual([
      { id: 1, result: images },
      [buffer],
    ]);
    expect(readImages).toHaveBeenCalledWith(0, ['a.png']);
  });
  it('validates SQLite input, reads bounded pages and closes the previous database', async () => {
    const info = { tables: [], skippedTables: false };
    const page = { rows: [], hasMore: false };
    const database = { info, readPage: jest.fn(() => page), dispose: jest.fn() };
    (loadSqlite as jest.Mock).mockResolvedValue({});
    (openSqlite as jest.Mock).mockReturnValue(database);
    const buffer = new ArrayBuffer(100);
    await request('openSqlite', { buffer });
    expect(validateSqlite).toHaveBeenCalledWith(buffer);
    expect((await request('sqlitePage', { table: 2, offset: 50 }))[0]).toEqual({ id: 1, result: page });
    expect(database.readPage).toHaveBeenCalledWith(2, 50);
    await request('openSqlite', { buffer });
    expect(database.dispose).toHaveBeenCalledTimes(1);
  });
});
