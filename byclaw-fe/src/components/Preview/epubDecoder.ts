import JSZip from 'jszip';
import { SaxesParser, type SaxesTagNS } from 'saxes';
import { BinaryPreviewError, MAX_ARCHIVE_ENTRIES, MAX_BINARY_PREVIEW_BYTES } from './binaryPreview';
import { readZipEntry } from './readZipEntry';
import {
  MAX_EPUB_CHAPTERS,
  MAX_EPUB_XML_BYTES,
  MAX_EPUB_IMAGES,
  MAX_EPUB_IMAGE_BYTES,
  MAX_EPUB_CHAPTER_IMAGE_BYTES,
  type EpubInfo,
  type EpubImage,
} from './epubTypes';

const OPF = 'http://www.idpf.org/2007/opf';
const CONTAINER = 'urn:oasis:names:tc:opendocument:xmlns:container';
const DC = 'http://purl.org/dc/elements/1.1/';
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/avif'];
interface XmlNode {
  tag: SaxesTagNS;
  children: XmlNode[];
  content: (XmlNode | string)[];
}
const attr = (node: XmlNode, name: string) =>
  Object.values(node.tag.attributes).find((item) => item.local === name && !item.uri)?.value || '';
const children = (node: XmlNode, uri: string, name: string) =>
  node.children.filter((item) => item.tag.uri === uri && item.tag.local === name);
const nodeText = (node: XmlNode): string =>
  node.content.map((item) => (typeof item === 'string' ? item : nodeText(item))).join('');

/** 不解析外部实体；只读取容器、书目和目录，章节内容另交给 HTML 清理器。 */
function parseXml(xml: string): XmlNode {
  const parser = new SaxesParser({ xmlns: true });
  const stack: XmlNode[] = [];
  let root: XmlNode | undefined;
  let count = 0;
  parser.on('doctype', (value) => {
    if (value.includes('[')) throw new BinaryPreviewError('unsupported');
  });
  parser.on('error', () => {
    throw new BinaryPreviewError('invalid');
  });
  parser.on('opentag', (tag) => {
    if (++count > 20000 || stack.length >= 128) throw new BinaryPreviewError('limit');
    const node: XmlNode = { tag, children: [], content: [] };
    if (stack.length) {
      const parent = stack[stack.length - 1];
      parent.children.push(node);
      parent.content.push(node);
    } else root = node;
    stack.push(node);
  });
  const append = (text: string) => {
    if (stack.length) stack[stack.length - 1].content.push(text);
  };
  parser.on('text', append);
  parser.on('cdata', append);
  parser.on('closetag', () => {
    stack.pop();
  });
  parser.write(xml).close();
  if (!root) throw new BinaryPreviewError('invalid');
  return root;
}

/** EPUB 的相对路径允许 ../，但不得离开压缩包根目录或访问网络。 */
export function resolveEpubPath(base: string, href: string): string {
  let path: string;
  try {
    path = decodeURIComponent(href.split(/[?#]/)[0]);
  } catch {
    throw new BinaryPreviewError('invalid');
  }
  if (!path || /^[a-z][a-z\d+.-]*:/i.test(path) || /^[/\\]/.test(path) || /[\\\x00-\x1f\x7f]/.test(path)) {
    throw new BinaryPreviewError('unsupported');
  }
  const parts = base ? base.split('/').slice(0, -1) : [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) throw new BinaryPreviewError('unsupported');
      parts.pop();
    } else parts.push(part);
  }
  return parts.join('/');
}

export async function openEpub(buffer: ArrayBuffer) {
  if (!buffer.byteLength) throw new BinaryPreviewError('invalid');
  if (buffer.byteLength > MAX_BINARY_PREVIEW_BYTES) throw new BinaryPreviewError('limit');
  const zip = await JSZip.loadAsync(buffer);
  if (Object.keys(zip.files).length > MAX_ARCHIVE_ENTRIES) throw new BinaryPreviewError('limit');
  // 包含加密资源的书籍不尝试解密（包括 DRM 和字体混淆）。
  if (zip.files['META-INF/encryption.xml']) throw new BinaryPreviewError('unsupported');
  const entry = (name: string) => {
    const file = zip.files[name];
    if (
      !file ||
      file.dir ||
      (file.unsafeOriginalName && file.unsafeOriginalName !== name) ||
      (Number(file.unixPermissions || 0) & 0xf000) === 0xa000
    )
      throw new BinaryPreviewError('invalid');
    return file;
  };
  const text = async (name: string, max = MAX_EPUB_XML_BYTES) =>
    new TextDecoder('utf-8', { fatal: true }).decode(await readZipEntry(entry(name), max));
  if ((await text('mimetype', 256)) !== 'application/epub+zip') throw new BinaryPreviewError('invalid');
  const container = parseXml(await text('META-INF/container.xml'));
  if (container.tag.uri !== CONTAINER || container.tag.local !== 'container') throw new BinaryPreviewError('invalid');
  const roots = children(container, CONTAINER, 'rootfiles')[0];
  const rootfile =
    roots &&
    children(roots, CONTAINER, 'rootfile').find((node) => attr(node, 'media-type') === 'application/oebps-package+xml');
  if (!rootfile) throw new BinaryPreviewError('invalid');
  const packagePath = resolveEpubPath('', attr(rootfile, 'full-path'));
  const book = parseXml(await text(packagePath));
  if (book.tag.uri !== OPF || book.tag.local !== 'package') throw new BinaryPreviewError('invalid');
  const manifestNode = children(book, OPF, 'manifest')[0];
  const spine = children(book, OPF, 'spine')[0];
  if (!manifestNode || !spine) throw new BinaryPreviewError('invalid');
  const manifest = new Map<string, { path: string; mime: string; properties: string }>();
  for (const node of children(manifestNode, OPF, 'item')) {
    const id = attr(node, 'id');
    if (!id || manifest.has(id)) throw new BinaryPreviewError('invalid');
    const href = attr(node, 'href');
    // 远程资源仅跳过；阅读正文和插图时仍只允许本压缩包内的资源。
    if (/^[a-z][a-z\d+.-]*:|^\/\//i.test(href)) continue;
    manifest.set(id, {
      path: resolveEpubPath(packagePath, href),
      mime: attr(node, 'media-type'),
      properties: attr(node, 'properties'),
    });
  }
  const chapters = children(spine, OPF, 'itemref').map((node) => {
    const item = manifest.get(attr(node, 'idref'));
    if (!item || !['application/xhtml+xml', 'text/html'].includes(item.mime))
      throw new BinaryPreviewError('unsupported');
    entry(item.path);
    return { path: item.path, name: '' };
  });
  if (!chapters.length) throw new BinaryPreviewError('invalid');
  if (chapters.length > MAX_EPUB_CHAPTERS) throw new BinaryPreviewError('limit');
  const metadata = children(book, OPF, 'metadata')[0];
  const titleNode = metadata && children(metadata, DC, 'title')[0];
  const title = titleNode ? nodeText(titleNode).trim().slice(0, 512) : '';
  const names = new Map<string, string>();
  const nav =
    [...manifest.values()].find((item) => item.properties.split(/\s+/).includes('nav')) ||
    manifest.get(attr(spine, 'toc'));
  if (nav) {
    try {
      const walk = (node: XmlNode) => {
        if (node.tag.local === 'a') {
          const href = attr(node, 'href');
          if (href) {
            try {
              const path = resolveEpubPath(nav.path, href);
              if (!names.has(path)) names.set(path, nodeText(node).trim().slice(0, 512));
            } catch {
              // 目录里的外部链接不会作为章节入口。
            }
          }
        } else if (node.tag.local === 'navPoint') {
          const content = node.children.find((item) => item.tag.local === 'content');
          const label = node.children.find((item) => item.tag.local === 'navLabel');
          if (content && label) {
            try {
              const path = resolveEpubPath(nav.path, attr(content, 'src'));
              if (!names.has(path)) names.set(path, nodeText(label).trim().slice(0, 512));
            } catch {
              // 单条目录损坏不阻断其他章节。
            }
          }
        }
        node.children.forEach(walk);
      };
      walk(parseXml(await text(nav.path)));
    } catch {
      // 缺失或不规范的目录使用章节序号，仍保持 spine 阅读顺序。
    }
  }
  chapters.forEach((chapter) => {
    chapter.name = names.get(chapter.path) || '';
  });
  const chapter = (index: number) => {
    if (!Number.isInteger(index) || !chapters[index]) throw new BinaryPreviewError('invalid');
    return chapters[index];
  };
  const imageManifest = new Map<string, string>(
    [...manifest.values()].filter((item) => IMAGE_MIMES.includes(item.mime)).map((item) => [item.path, item.mime])
  );
  return {
    info: { title, chapters: chapters.map(({ name }) => ({ name })) } as EpubInfo,
    readChapter: (index: number) => text(chapter(index).path),
    async readImages(index: number, sources: string[]): Promise<EpubImage[]> {
      const base = chapter(index).path;
      if (sources.length > MAX_EPUB_IMAGES) throw new BinaryPreviewError('limit');
      const images: EpubImage[] = [];
      let total = 0;
      for (const source of new Set(sources)) {
        try {
          const path = resolveEpubPath(base, source);
          const mime = imageManifest.get(path);
          if (!mime) continue;
          const image = await readZipEntry(
            entry(path),
            Math.min(MAX_EPUB_IMAGE_BYTES, MAX_EPUB_CHAPTER_IMAGE_BYTES - total)
          );
          total += image.byteLength;
          images.push({ source, mime, buffer: image });
        } catch {
          // 单张插图不可用时仍允许阅读正文和其他插图。
        }
      }
      return images;
    },
  };
}
