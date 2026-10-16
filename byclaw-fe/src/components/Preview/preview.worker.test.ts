import { openEpub } from './epubDecoder';
import { openSqlite, validateSqlite } from './sqliteDecoder';
import { loadSqlite } from './loadSqlite';

jest.mock('./epubDecoder', () => ({ openEpub: jest.fn() }));
jest.mock('./sqliteDecoder', () => ({ openSqlite: jest.fn(), validateSqlite: jest.fn() }));
jest.mock('./loadSqlite', () => ({ loadSqlite: jest.fn() }));

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
