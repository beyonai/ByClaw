import JSZip from 'jszip';
import { SaxesParser, type SaxesTagNS } from 'saxes';
import { BinaryPreviewError, MAX_ARCHIVE_ENTRIES, MAX_BINARY_PREVIEW_BYTES } from './binaryPreview';
import { readZipEntry } from './readZipEntry';
import {
  MAX_ODF_HTML,
  MAX_ODF_IMAGES,
  MAX_ODF_IMAGE_BYTES,
  MAX_ODF_NODES,
  MAX_ODF_PAGES,
  MAX_ODF_XML_BYTES,
  type OpenDocumentContent,
  type OpenDocumentType,
} from './openDocumentTypes';

const OFFICE = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';
const TEXT = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
const DRAW = 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0';
const TABLE = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
const PRESENTATION = 'urn:oasis:names:tc:opendocument:xmlns:presentation:1.0';
const XLINK = 'http://www.w3.org/1999/xlink';
const TABLE_TAGS = new Map([
  ['table', 'table'],
  ['table-row', 'tr'],
  ['table-cell', 'td'],
  ['covered-table-cell', 'td'],
]);
const attribute = (tag: SaxesTagNS, uri: string, local: string) =>
  Object.values(tag.attributes).find((item) => item.uri === uri && item.local === local)?.value;
const escape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const safePath = (name: string) =>
  !!name &&
  !/[\\:\x00-\x1f?#]/.test(name) &&
  !name.startsWith('/') &&
  !name.split('/').some((part) => part === '..' || part === '.');

/** 顺序提取正文结构；不展开重复行列，不加载宏、对象、动画、样式或外部链接。 */
export function parseOpenDocument(xml: string, type: OpenDocumentType) {
  const result: OpenDocumentContent = { pages: [], omitted: false };
  const images: { page: number; marker: string; source: string }[] = [];
  const stack: { tag: SaxesTagNS; close: string }[] = [];
  const parser = new SaxesParser({ xmlns: true });
  let bodyDepth = 0;
  let pageDepth = 0;
  let ignoredDepth = 0;
  let foundBody = false;
  let textDepth = 0;
  let nodeCount = 0;
  let htmlLength = 0;
  const append = (html: string) => {
    if (!result.pages.length) return;
    htmlLength += html.length;
    if (htmlLength > MAX_ODF_HTML) throw new BinaryPreviewError('limit');
    result.pages[result.pages.length - 1].html += html;
  };
  parser.on('doctype', () => {
    throw new BinaryPreviewError('unsupported');
  });
  parser.on('error', () => {
    throw new BinaryPreviewError('invalid');
  });
  parser.on('opentag', (tag) => {
    const parent = stack[stack.length - 1]?.tag;
    const entry = { tag, close: '' };
    stack.push(entry);
    const depth = stack.length;
    if (++nodeCount > MAX_ODF_NODES || depth > 128) throw new BinaryPreviewError('limit');
    if (depth === 1 && (tag.uri !== OFFICE || tag.local !== 'document-content'))
      throw new BinaryPreviewError('invalid');
    if (ignoredDepth) return;
    if (
      depth === 3 &&
      parent?.uri === OFFICE &&
      parent.local === 'body' &&
      tag.uri === OFFICE &&
      tag.local === (type === 'odt' ? 'text' : 'presentation')
    ) {
      if (foundBody) throw new BinaryPreviewError('invalid');
      bodyDepth = depth;
      foundBody = true;
      if (type === 'odt') result.pages.push({ name: '', html: '' });
      return;
    }
    if (!bodyDepth) return;
    if (type === 'odp' && depth === bodyDepth + 1 && tag.uri === DRAW && tag.local === 'page') {
      if (result.pages.length >= MAX_ODF_PAGES) throw new BinaryPreviewError('limit');
      result.pages.push({ name: (attribute(tag, DRAW, 'name') || '').slice(0, 256), html: '' });
      pageDepth = depth;
      return;
    }
    if (type === 'odp' && !pageDepth) return;
    if (
      (tag.uri === OFFICE && ['annotation', 'binary-data', 'event-listeners'].includes(tag.local)) ||
      (tag.uri === TEXT && ['tracked-changes', 'script'].includes(tag.local)) ||
      (tag.uri === PRESENTATION && tag.local === 'notes') ||
      (tag.uri === DRAW && ['object', 'object-ole', 'plugin', 'applet'].includes(tag.local))
    ) {
      ignoredDepth = depth;
      result.omitted = true;
      return;
    }
    let htmlTag = '';
    if (tag.uri === TEXT) {
      if (['p', 'h'].includes(tag.local)) {
        const level = Math.trunc(Number(attribute(tag, TEXT, 'outline-level')) || 1);
        htmlTag = tag.local === 'h' ? `h${Math.max(1, Math.min(6, level))}` : 'p';
        textDepth++;
      } else if (tag.local === 'list') htmlTag = 'ul';
      else if (tag.local === 'list-item') htmlTag = 'li';
      else if (tag.local === 's' && textDepth) {
        const count = Number(attribute(tag, TEXT, 'c') || 1);
        if (!Number.isInteger(count) || count < 1 || count > 10000) throw new BinaryPreviewError('limit');
        append(' '.repeat(count));
      } else if (tag.local === 'tab' && textDepth) append('\t');
      else if (tag.local === 'line-break' && textDepth) append('<br>');
    } else if (tag.uri === TABLE) {
      htmlTag = TABLE_TAGS.get(tag.local) || '';
      if (
        Object.values(tag.attributes).some(
          (attr) => attr.uri === TABLE && /(?:repeated|spanned)$/.test(attr.local) && attr.value !== '1'
        )
      )
        result.omitted = true;
    } else if (tag.uri === DRAW && tag.local === 'image') {
      const source = (attribute(tag, XLINK, 'href') || '').replace(/^\.\//, '');
      if (images.length < MAX_ODF_IMAGES && safePath(source) && /\.(?:png|jpe?g)$/i.test(source)) {
        const marker = `<!--odf-image-${images.length}-->`;
        images.push({ page: result.pages.length - 1, marker, source });
        append(marker);
      } else result.omitted = true;
      // 图片的 binary-data 不是正文文字，不能混入父段落。
      ignoredDepth = depth;
    }
    if (htmlTag) {
      append(`<${htmlTag}>`);
      entry.close = `</${htmlTag}>`;
    }
  });
  const text = (value: string) => {
    if (!ignoredDepth && bodyDepth && textDepth) append(escape(value));
  };
  parser.on('text', text);
  parser.on('cdata', text);
  parser.on('closetag', () => {
    const depth = stack.length;
    const entry = stack.pop()!;
    if (ignoredDepth) {
      if (ignoredDepth === depth) ignoredDepth = 0;
    } else {
      append(entry.close);
      if (entry.close && entry.tag.uri === TEXT && ['p', 'h'].includes(entry.tag.local)) textDepth--;
      if (depth === pageDepth) pageDepth = 0;
      if (depth === bodyDepth) bodyDepth = 0;
    }
  });
  parser.write(xml).close();
  if (!foundBody) throw new BinaryPreviewError('invalid');
  return { result, images };
}

export async function decodeOpenDocument(buffer: ArrayBuffer, type: OpenDocumentType): Promise<OpenDocumentContent> {
  if (!buffer.byteLength || !['odt', 'odp'].includes(type)) throw new BinaryPreviewError('invalid');
  if (buffer.byteLength > MAX_BINARY_PREVIEW_BYTES) throw new BinaryPreviewError('limit');
  const zip = await JSZip.loadAsync(buffer);
  if (Object.keys(zip.files).length > MAX_ARCHIVE_ENTRIES) throw new BinaryPreviewError('limit');
  const required = (name: string) => {
    const entry = zip.files[name];
    if (
      !entry ||
      entry.dir ||
      (entry.unsafeOriginalName && entry.unsafeOriginalName !== name) ||
      (Number(entry.unixPermissions || 0) & 0xf000) === 0xa000
    )
      throw new BinaryPreviewError('invalid');
    return entry;
  };
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const mime = `application/vnd.oasis.opendocument.${type === 'odt' ? 'text' : 'presentation'}`;
  if (decoder.decode(await readZipEntry(required('mimetype'), 256)) !== mime) throw new BinaryPreviewError('invalid');
  const { result, images } = parseOpenDocument(
    decoder.decode(await readZipEntry(required('content.xml'), MAX_ODF_XML_BYTES)),
    type
  );
  let totalImageBytes = 0;
  for (const image of images) {
    let html = '';
    try {
      const bytes = new Uint8Array(await readZipEntry(required(image.source), MAX_ODF_IMAGE_BYTES));
      totalImageBytes += bytes.length;
      if (totalImageBytes > 8 * 1024 * 1024) throw new BinaryPreviewError('limit');
      const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
      const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      if (!png && !jpeg) throw new BinaryPreviewError('invalid');
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 8192)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      html = `<img alt="" src="data:image/${png ? 'png' : 'jpeg'};base64,${btoa(binary)}">`;
    } catch (error) {
      if (error instanceof BinaryPreviewError && error.code === 'limit') throw error;
      result.omitted = true;
    }
    result.pages[image.page].html = result.pages[image.page].html.replace(image.marker, html);
  }
  return result;
}
