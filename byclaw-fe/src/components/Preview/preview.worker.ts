import { BinaryPreviewError, fitDecodedImage } from './binaryPreview';
import type { ImageDocument } from './imageDecoder';
import type { openArchive } from './archiveDecoder';
import type { openEpub } from './epubDecoder';
import type { openSqlite } from './sqliteDecoder';

let image: ImageDocument | undefined;
let archive: Awaited<ReturnType<typeof openArchive>> | undefined;
let book: Awaited<ReturnType<typeof openEpub>> | undefined;
let database: ReturnType<typeof openSqlite> | undefined;

// 每个预览面板独占一个 worker；切换文件/关闭时 terminate 会同时释放解码器和解压缓存。
const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

workerScope.onmessage = async ({ data: { id, operation, input } }) => {
  try {
    let result: unknown;
    const transfer: Transferable[] = [];
    switch (operation) {
      case 'openImage': {
        image?.dispose();
        const { openImageDocument } = await import('./imageDecoder');
        image = await openImageDocument(input.buffer, input.type);
        result = image.count;
        break;
      }
      case 'imagePage': {
        if (!image) throw new BinaryPreviewError('invalid');
        const page = fitDecodedImage(await image.render(input.page));
        result = page;
        transfer.push(page.pixels.buffer as ArrayBuffer);
        break;
      }
      case 'openZip': {
        const { openArchive: load } = await import('./archiveDecoder');
        archive = await load(input.buffer);
        result = archive.entries;
        break;
      }
      case 'zipEntry': {
        if (!archive) throw new BinaryPreviewError('invalid');
        const buffer = await archive.extract(input.name);
        result = buffer;
        transfer.push(buffer);
        break;
      }
      case 'readOds': {
        const { decodeOds } = await import('./odsDecoder');
        result = await decodeOds(input.buffer);
        break;
      }
      case 'openEpub': {
        book = undefined;
        const { openEpub: load } = await import('./epubDecoder');
        book = await load(input.buffer);
        result = book.info;
        break;
      }
      case 'epubChapter': {
        if (!book) throw new BinaryPreviewError('invalid');
        result = await book.readChapter(input.chapter);
        break;
      }
      case 'epubImages': {
        if (!book) throw new BinaryPreviewError('invalid');
        const images = await book.readImages(input.chapter, input.sources);
        result = images;
        images.forEach(({ buffer }) => transfer.push(buffer));
        break;
      }
      case 'openSqlite': {
        database?.dispose();
        database = undefined;
        const { openSqlite: load, validateSqlite } = await import('./sqliteDecoder');
        validateSqlite(input.buffer);
        const { loadSqlite } = await import('./loadSqlite');
        database = load(input.buffer, await loadSqlite());
        result = database.info;
        break;
      }
      case 'sqlitePage': {
        if (!database) throw new BinaryPreviewError('invalid');
        result = database.readPage(input.table, input.offset);
        break;
      }
      default:
        throw new BinaryPreviewError('unsupported');
    }
    workerScope.postMessage({ id, result }, transfer);
  } catch (error) {
    workerScope.postMessage({ id, error: error instanceof BinaryPreviewError ? error.code : 'invalid' });
  }
};
