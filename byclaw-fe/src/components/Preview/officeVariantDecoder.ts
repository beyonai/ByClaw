import JSZip from 'jszip';
import { SaxesParser } from 'saxes';
import { BinaryPreviewError, MAX_ARCHIVE_ENTRIES, MAX_BINARY_PREVIEW_BYTES } from './binaryPreview';
import { readZipEntry } from './readZipEntry';
import {
  OFFICE_VARIANTS,
  OFFICE_MAIN_PARTS,
  OFFICE_MAIN_CONTENT_TYPES,
  MAX_OFFICE_EXPANDED_BYTES,
  MAX_OFFICE_METADATA_BYTES,
  type OfficeVariantType,
} from './officeVariantTypes';

const CONTENT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
type MetadataEntry = { name: string; attributes: Record<string, string> };
const escape = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/\r/g, '&#13;')
    .replace(/\n/g, '&#10;')
    .replace(/\t/g, '&#9;');
const blockedType = (value: string) => /vba|activex|oleobject|macrosheet/i.test(value);
const blockedPath = (value: string) =>
  /(?:^|\/)(?:vba[^/]*|activeX|embeddings|macrosheets|_xmlsignatures)(?:\/|$)/i.test(value);
const safePath = (value: string) =>
  !!value &&
  !/[\\:\x00-\x1f?#]/.test(value) &&
  !value.startsWith('/') &&
  !value.split('/').some((part) => part === '..' || part === '.');

/** 这里只解析两类扁平的 OPC 元数据；拒绝 DTD 与额外层级，不把正文 XML 当作配置执行。 */
function readMetadata(xml: string, root: 'Types' | 'Relationships', namespace: string): MetadataEntry[] {
  const parser = new SaxesParser({ xmlns: true });
  const entries: MetadataEntry[] = [];
  let depth = 0;
  let foundRoot = false;
  parser.on('doctype', () => {
    throw new BinaryPreviewError('unsupported');
  });
  parser.on('error', () => {
    throw new BinaryPreviewError('invalid');
  });
  parser.on('opentag', (tag) => {
    depth++;
    if (tag.uri !== namespace || depth > 2) throw new BinaryPreviewError('invalid');
    if (depth === 1) {
      if (tag.local !== root) throw new BinaryPreviewError('invalid');
      foundRoot = true;
      return;
    }
    if (!(root === 'Types' ? ['Default', 'Override'] : ['Relationship']).includes(tag.local))
      throw new BinaryPreviewError('invalid');
    if (entries.length >= 10000) throw new BinaryPreviewError('limit');
    const attributes: Record<string, string> = Object.create(null);
    Object.values(tag.attributes).forEach((attr) => {
      if (!attr.uri) attributes[attr.local] = attr.value;
    });
    entries.push({ name: tag.local, attributes });
  });
  parser.on('closetag', () => {
    depth--;
  });
  parser.on('text', (text) => {
    if (text.trim()) throw new BinaryPreviewError('invalid');
  });
  parser.write(xml).close();
  if (!foundRoot) throw new BinaryPreviewError('invalid');
  return entries;
}
function writeMetadata(root: string, namespace: string, entries: MetadataEntry[]) {
  return `<?xml version="1.0" encoding="UTF-8"?><${root} xmlns="${namespace}">${entries
    .map(
      ({ name, attributes }) =>
        `<${name} ${Object.entries(attributes)
          .map(([key, value]) => `${key}="${escape(value)}"`)
          .join(' ')}/>`
    )
    .join('')}</${root}>`;
}

function validateMainXml(xml: string, base: 'docx' | 'xlsx' | 'pptx') {
  const expected = {
    docx: ['document', 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'],
    xlsx: ['workbook', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'],
    pptx: ['presentation', 'http://schemas.openxmlformats.org/presentationml/2006/main'],
  }[base];
  const parser = new SaxesParser({ xmlns: true });
  let depth = 0;
  let nodes = 0;
  parser.on('doctype', () => {
    throw new BinaryPreviewError('unsupported');
  });
  parser.on('error', () => {
    throw new BinaryPreviewError('invalid');
  });
  parser.on('opentag', (tag) => {
    if (++depth > 128 || ++nodes > 100000) throw new BinaryPreviewError('limit');
    if (nodes === 1 && (tag.local !== expected[0] || tag.uri !== expected[1])) throw new BinaryPreviewError('invalid');
  });
  parser.on('closetag', () => {
    depth--;
  });
  parser.write(xml).close();
}

/** 验证真实 OOXML 类型并生成静态预览副本，原始宏/模板文件不修改、不改名。 */
export async function prepareOfficeVariant(buffer: ArrayBuffer, type: OfficeVariantType): Promise<ArrayBuffer> {
  if (!Object.prototype.hasOwnProperty.call(OFFICE_VARIANTS, type) || !buffer.byteLength)
    throw new BinaryPreviewError('invalid');
  if (buffer.byteLength > MAX_BINARY_PREVIEW_BYTES) throw new BinaryPreviewError('limit');
  const zip = await JSZip.loadAsync(buffer);
  const files = Object.values(zip.files);
  if (files.length > MAX_ARCHIVE_ENTRIES) throw new BinaryPreviewError('limit');
  if (
    files.some(
      (entry) =>
        !safePath(entry.name) ||
        !safePath(entry.unsafeOriginalName || entry.name) ||
        (Number(entry.unixPermissions || 0) & 0xf000) === 0xa000
    )
  )
    throw new BinaryPreviewError('invalid');
  const base = OFFICE_VARIANTS[type];
  const mainPart = OFFICE_MAIN_PARTS[base];
  const loaded = new Map<string, ArrayBuffer>();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let total = 0;
  const read = async (name: string) => {
    const cached = loaded.get(name);
    if (cached) return cached;
    const entry = zip.files[name];
    if (!entry || entry.dir) throw new BinaryPreviewError('invalid');
    const metadata = name === '[Content_Types].xml' || name.endsWith('.rels');
    const bytes = await readZipEntry(
      entry,
      Math.min(metadata ? MAX_OFFICE_METADATA_BYTES : MAX_BINARY_PREVIEW_BYTES, MAX_OFFICE_EXPANDED_BYTES - total)
    );
    total += bytes.byteLength;
    loaded.set(name, bytes);
    return bytes;
  };
  const types = readMetadata(decoder.decode(await read('[Content_Types].xml')), 'Types', CONTENT_NS);
  const mainTypes = types.filter(
    ({ name, attributes }) => name === 'Override' && attributes.PartName === `/${mainPart}`
  );
  if (
    mainTypes.length !== 1 ||
    mainTypes[0].attributes.ContentType !== OFFICE_MAIN_CONTENT_TYPES[type] ||
    !zip.files[mainPart] ||
    zip.files[mainPart].dir
  )
    throw new BinaryPreviewError('invalid');
  const rootRelationships = readMetadata(decoder.decode(await read('_rels/.rels')), 'Relationships', REL_NS);
  const officeRelationships = rootRelationships.filter(({ attributes }) => attributes.Type === OFFICE_REL);
  if (
    officeRelationships.length !== 1 ||
    officeRelationships[0].attributes.TargetMode === 'External' ||
    officeRelationships[0].attributes.Target?.replace(/^\//, '') !== mainPart
  )
    throw new BinaryPreviewError('invalid');
  validateMainXml(decoder.decode(await read(mainPart)), base);

  const removed = new Set(files.filter((entry) => blockedPath(entry.name)).map((entry) => entry.name));
  types.forEach(({ attributes }) => {
    if (blockedType(attributes.ContentType || '') && attributes.PartName)
      removed.add(attributes.PartName.replace(/^\//, ''));
  });
  const prepared = new JSZip();
  for (const entry of files) {
    if (entry.dir || removed.has(entry.name) || entry.name === '[Content_Types].xml') continue;
    const bytes = await read(entry.name);
    if (entry.name.endsWith('.rels')) {
      const owner =
        entry.name === '_rels/.rels' ? '' : entry.name.replace(/(^|\/)_rels\//, '$1').replace(/\.rels$/, '');
      const relationships = readMetadata(decoder.decode(bytes), 'Relationships', REL_NS).filter(({ attributes }) => {
        // 删除宏、ActiveX、嵌入对象和外链关系；浏览器只接触文件包中的静态内容。
        if (attributes.TargetMode === 'External' || blockedType(attributes.Type || '')) return false;
        if (!attributes.Target) throw new BinaryPreviewError('invalid');
        const url = new URL(attributes.Target, `https://preview.invalid/${owner}`);
        if (url.origin !== 'https://preview.invalid' || url.search || url.hash) throw new BinaryPreviewError('invalid');
        const path = decodeURIComponent(url.pathname.slice(1));
        if (!safePath(path)) throw new BinaryPreviewError('invalid');
        return !removed.has(path) && !blockedPath(path);
      });
      prepared.file(entry.name, writeMetadata('Relationships', REL_NS, relationships));
    } else prepared.file(entry.name, bytes);
  }
  const safeTypes = types.filter(
    ({ attributes }) =>
      !blockedType(attributes.ContentType || '') && !removed.has((attributes.PartName || '').replace(/^\//, ''))
  );
  // main+xml 的变体声明只在预览副本中归一化，不能用重命名绕过格式验证。
  mainTypes[0].attributes.ContentType = OFFICE_MAIN_CONTENT_TYPES[base];
  prepared.file('[Content_Types].xml', writeMetadata('Types', CONTENT_NS, safeTypes));
  return prepared.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}
