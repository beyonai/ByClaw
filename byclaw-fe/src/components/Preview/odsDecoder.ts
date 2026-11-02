import JSZip from 'jszip';
import { SaxesParser, type SaxesTagNS } from 'saxes';
import { BinaryPreviewError, MAX_ARCHIVE_ENTRIES, MAX_BINARY_PREVIEW_BYTES } from './binaryPreview';
import { readZipEntry } from './readZipEntry';
import {
  MAX_ODS_CELL_TEXT,
  MAX_ODS_CELLS,
  MAX_ODS_COLUMNS,
  MAX_ODS_ROWS,
  MAX_ODS_SHEETS,
  MAX_ODS_TEXT,
  MAX_ODS_XML_BYTES,
  type OdsSheet,
} from './odsTypes';

const OFFICE = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';
const TABLE = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
const TEXT = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
const DRAW = 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0';
const ODS_MIME = 'application/vnd.oasis.opendocument.spreadsheet';

const matches = (tag: SaxesTagNS | undefined, uri: string, local: string) => tag?.uri === uri && tag.local === local;
const attribute = (tag: SaxesTagNS, uri: string, local: string) =>
  Object.values(tag.attributes).find((item) => item.uri === uri && item.local === local)?.value;

function positiveInteger(value?: string) {
  if (value === undefined) return 1;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) {
    throw new BinaryPreviewError('invalid');
  }
  return Number(value);
}

/** 只读取工作簿保存的值，不执行公式、宏或外部链接；命名空间别名不影响识别。 */
export function parseOdsContent(xml: string): OdsSheet[] {
  const parser = new SaxesParser({ xmlns: true });
  const stack: SaxesTagNS[] = [];
  const sheets: OdsSheet[] = [];
  let spreadsheetDepth = 0;
  let foundSpreadsheet = false;
  let sheetDepth = 0;
  let ignoredDepth = 0;
  let sheet: OdsSheet | undefined;
  let row: { depth: number; cells: string[]; column: number; repeat: number; hasValue: boolean } | undefined;
  let cell:
    | { depth: number; text: string; paragraphs: number; repeat: number; fallback: string; covered: boolean }
    | undefined;
  let paragraphDepth = 0;
  let rowIndex = 0;
  let storedCells = 0;
  let storedText = 0;

  const append = (text: string) => {
    if (!cell || !sheet || cell.covered) return;
    const remaining = MAX_ODS_CELL_TEXT - cell.text.length;
    if (text.length > remaining) sheet.truncated = true;
    cell.text += text.slice(0, remaining);
  };

  parser.on('doctype', () => {
    throw new BinaryPreviewError('unsupported');
  });
  parser.on('error', () => {
    throw new BinaryPreviewError('invalid');
  });
  parser.on('opentag', (tag) => {
    const parent = stack[stack.length - 1];
    stack.push(tag);
    const depth = stack.length;
    if (depth > 128) throw new BinaryPreviewError('limit');
    if (depth === 1 && !matches(tag, OFFICE, 'document-content')) throw new BinaryPreviewError('invalid');
    if (ignoredDepth) return;
    if (matches(tag, OFFICE, 'spreadsheet') && matches(parent, OFFICE, 'body') && depth === 3) {
      if (foundSpreadsheet) throw new BinaryPreviewError('invalid');
      spreadsheetDepth = depth;
      foundSpreadsheet = true;
    } else if (matches(tag, TABLE, 'table') && spreadsheetDepth && depth === spreadsheetDepth + 1) {
      if (sheets.length >= MAX_ODS_SHEETS) throw new BinaryPreviewError('limit');
      sheet = { name: attribute(tag, TABLE, 'name') || '', rows: [], columnCount: 0, truncated: false };
      if (sheet.name.length > MAX_ODS_CELL_TEXT) throw new BinaryPreviewError('limit');
      sheets.push(sheet);
      sheetDepth = depth;
      rowIndex = 0;
    } else if (
      sheet &&
      (matches(tag, TABLE, 'table') ||
        tag.uri === DRAW ||
        matches(tag, OFFICE, 'annotation') ||
        matches(tag, TEXT, 'note'))
    ) {
      // 图形、批注与嵌套表格中的文字不能混入当前单元格值。
      ignoredDepth = depth;
    } else if (sheet && matches(tag, TABLE, 'table-row')) {
      if (row) throw new BinaryPreviewError('unsupported');
      row = {
        depth,
        cells: [],
        column: 0,
        repeat: positiveInteger(attribute(tag, TABLE, 'number-rows-repeated')),
        hasValue: false,
      };
    } else if (
      sheet &&
      row &&
      depth === row.depth + 1 &&
      tag.uri === TABLE &&
      ['table-cell', 'covered-table-cell'].includes(tag.local)
    ) {
      const valueType = attribute(tag, OFFICE, 'value-type');
      const cached =
        valueType === 'boolean'
          ? attribute(tag, OFFICE, 'boolean-value')
          : attribute(tag, OFFICE, 'string-value') ??
            attribute(tag, OFFICE, 'date-value') ??
            attribute(tag, OFFICE, 'time-value') ??
            attribute(tag, OFFICE, 'value');
      const formula = attribute(tag, TABLE, 'formula') || '';
      cell = {
        depth,
        text: '',
        paragraphs: 0,
        repeat: positiveInteger(attribute(tag, TABLE, 'number-columns-repeated')),
        fallback: tag.local === 'covered-table-cell' ? '' : cached ?? formula.replace(/^[\w.-]+:(?==)/, ''),
        covered: tag.local === 'covered-table-cell',
      };
    } else if (cell && matches(tag, TEXT, 'p') && !paragraphDepth) {
      if (cell.paragraphs++) append('\n');
      paragraphDepth = depth;
    } else if (cell && paragraphDepth && matches(tag, TEXT, 's')) {
      const count = positiveInteger(attribute(tag, TEXT, 'c'));
      if (count > MAX_ODS_CELL_TEXT) sheet!.truncated = true;
      append(' '.repeat(Math.min(count, MAX_ODS_CELL_TEXT)));
    } else if (cell && paragraphDepth && matches(tag, TEXT, 'tab')) {
      append('\t');
    } else if (cell && paragraphDepth && matches(tag, TEXT, 'line-break')) {
      append('\n');
    }
  });
  const text = (value: string) => {
    if (!ignoredDepth && paragraphDepth) append(value);
  };
  parser.on('text', text);
  parser.on('cdata', text);
  parser.on('closetag', () => {
    const depth = stack.length;
    if (ignoredDepth) {
      if (depth === ignoredDepth) ignoredDepth = 0;
    } else {
      if (depth === paragraphDepth) paragraphDepth = 0;
      if (cell && row && sheet && depth === cell.depth) {
        // 部分导出器保留空 text:p，仍应展示缓存值或未计算的公式。
        const value = cell.text || cell.fallback.slice(0, MAX_ODS_CELL_TEXT);
        if (!cell.text && cell.fallback.length > MAX_ODS_CELL_TEXT) sheet.truncated = true;
        if (value) {
          row.hasValue = true;
          if (row.column + cell.repeat > MAX_ODS_COLUMNS) sheet.truncated = true;
          const end = Math.min(MAX_ODS_COLUMNS, row.column + cell.repeat);
          for (let column = row.column; column < end; column++) row.cells[column] = value;
        }
        // ODS 可以把百万个空单元格写成一个重复计数；只推进坐标，禁止先展开再截断。
        row.column = Math.min(MAX_ODS_COLUMNS + 1, row.column + cell.repeat);
        cell = undefined;
      }
      if (row && sheet && depth === row.depth) {
        if (row.hasValue) {
          if (rowIndex + row.repeat > MAX_ODS_ROWS) sheet.truncated = true;
          const count = Math.max(0, Math.min(row.repeat, MAX_ODS_ROWS - rowIndex));
          const cells = Array.from({ length: row.cells.length }, (_, index) => row!.cells[index] || '');
          storedCells += count * cells.length;
          storedText += count * cells.reduce((sum, value) => sum + value.length, 0);
          if (storedCells > MAX_ODS_CELLS || storedText > MAX_ODS_TEXT) throw new BinaryPreviewError('limit');
          if (count && cells.length) {
            while (sheet.rows.length < rowIndex) sheet.rows.push([]);
            for (let index = 0; index < count; index++) sheet.rows.push(cells);
            sheet.columnCount = Math.max(sheet.columnCount, cells.length);
          }
        }
        rowIndex = Math.min(MAX_ODS_ROWS + 1, rowIndex + row.repeat);
        row = undefined;
      }
      if (depth === sheetDepth) {
        sheet = undefined;
        sheetDepth = 0;
      }
      if (depth === spreadsheetDepth) spreadsheetDepth = 0;
    }
    stack.pop();
  });
  parser.write(xml).close();
  if (!foundSpreadsheet) throw new BinaryPreviewError('invalid');
  return sheets;
}

export async function decodeOds(buffer: ArrayBuffer): Promise<OdsSheet[]> {
  if (!buffer.byteLength) throw new BinaryPreviewError('invalid');
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
    ) {
      throw new BinaryPreviewError('invalid');
    }
    return entry;
  };
  const decoder = new TextDecoder('utf-8', { fatal: true });
  if (decoder.decode(await readZipEntry(required('mimetype'), 256)) !== ODS_MIME)
    throw new BinaryPreviewError('invalid');
  // 只展开正文；图片、嵌入对象、宏和外部资源都不读取。
  const content = await readZipEntry(required('content.xml'), MAX_ODS_XML_BYTES);
  return parseOdsContent(decoder.decode(content));
}
