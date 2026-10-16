import { TextDecoder as NodeTextDecoder } from 'util';
import JSZip from 'jszip';
import { decodeOds, parseOdsContent } from './odsDecoder';
import { MAX_BINARY_PREVIEW_BYTES } from './binaryPreview';
import { MAX_ODS_CELL_TEXT, MAX_ODS_COLUMNS, MAX_ODS_ROWS, MAX_ODS_SHEETS, MAX_ODS_XML_BYTES } from './odsTypes';

const mime = 'application/vnd.oasis.opendocument.spreadsheet';
const documentXml = (tables: string) => `<?xml version="1.0" encoding="UTF-8"?>
<o:document-content xmlns:o="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
 xmlns:t="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
 xmlns:x="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
 xmlns:d="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0">
 <o:body><o:spreadsheet>${tables}</o:spreadsheet></o:body></o:document-content>`;
const table = (rows: string, name = '数据') => `<t:table t:name="${name}">${rows}</t:table>`;
const cell = (text: string, attributes = '') => `<t:table-cell ${attributes}><x:p>${text}</x:p></t:table-cell>`;
const row = (cells: string, attributes = '') => `<t:table-row ${attributes}>${cells}</t:table-row>`;
const encodeZip = (zip: JSZip, platform: 'DOS' | 'UNIX' = 'DOS') =>
  zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE', platform });
const workbook = (xml: string) => new JSZip().file('mimetype', mime).file('content.xml', xml);

describe('ODS saved-value preview using real ZIP and namespace-aware XML', () => {
  beforeAll(() => {
    Object.defineProperty(global, 'TextDecoder', { configurable: true, value: NodeTextDecoder });
  });

  it('reads Chinese worksheets, saved values and formula text without evaluating formulas', async () => {
    const values = row(
      cell('中文 &amp; &lt;script&gt;') +
        '<t:table-cell o:value-type="float" o:value="0" t:formula="of:=1-1"><x:p/></t:table-cell>' +
        '<t:table-cell o:value-type="boolean" o:boolean-value="false"/>' +
        '<t:table-cell o:value-type="date" o:date-value="2026-10-15"/>' +
        '<t:table-cell o:value-type="time" o:time-value="PT1H"/>' +
        '<t:table-cell t:formula="of:=SUM(A1:B1)"><x:p/></t:table-cell>'
    );
    const zip = workbook(documentXml(table(values, '统计') + table(row(cell('第二表')), '明细')));
    // 不支持的二进制资源无需解压，正文仍可读取。
    zip.file('Pictures/image.bin', new Uint8Array([1, 2, 3]));
    const result = await decodeOds(await encodeZip(zip));
    expect(result.map((sheet) => sheet.name)).toEqual(['统计', '明细']);
    expect(result[0].rows).toEqual([['中文 & <script>', '0', 'false', '2026-10-15', 'PT1H', '=SUM(A1:B1)']]);
    expect(result[0].columnCount).toBe(6);
    expect(result[1].rows).toEqual([['第二表']]);
  });

  it('keeps paragraph whitespace and merged-cell coordinates while excluding annotations and drawings', () => {
    const rich =
      '<t:table-cell><x:p>A<x:span>B</x:span><x:s x:c="2"/>C<x:tab/>D<x:line-break/>E</x:p>' +
      '<x:p><![CDATA[<raw>]]><o:annotation><x:p>hidden note</x:p></o:annotation>' +
      '<d:frame><x:p>hidden drawing</x:p></d:frame></x:p></t:table-cell>';
    const result = parseOdsContent(
      documentXml(
        table(
          '<t:table-row t:number-rows-repeated="2"/>' +
            row('<t:covered-table-cell/>' + rich + '<t:covered-table-cell/>' + cell('end'))
        )
      )
    );
    expect(result[0].rows).toEqual([[], [], ['', 'AB  C\tD\nE\n<raw>', '', 'end']]);
    expect(result[0].truncated).toBe(false);
  });

  it('expands repeated nonempty rows and cells only inside the visible bounds', () => {
    const result = parseOdsContent(
      documentXml(table(row(cell('value', 't:number-columns-repeated="1000000"'), 't:number-rows-repeated="1000000"')))
    )[0];
    expect(result.rows).toHaveLength(MAX_ODS_ROWS);
    expect(result.columnCount).toBe(MAX_ODS_COLUMNS);
    expect(result.rows[999][99]).toBe('value');
    expect(result.truncated).toBe(true);
  });

  it('does not allocate repeated empty tails, but signals omitted data beyond those coordinates', () => {
    const emptyTail =
      '<t:table-row t:number-rows-repeated="1000000000"><t:table-cell t:number-columns-repeated="1000000000"/></t:table-row>';
    const result = parseOdsContent(documentXml(table(row(cell('first')) + emptyTail)))[0];
    expect(result.rows).toEqual([['first']]);
    expect(result.truncated).toBe(false);
    const omitted = parseOdsContent(documentXml(table(emptyTail + row(cell('outside')))))[0];
    expect(omitted.rows).toEqual([]);
    expect(omitted.truncated).toBe(true);
  });

  it('bounds cell text and rejects excessive aggregate content or worksheet counts', () => {
    const result = parseOdsContent(documentXml(table(row(cell('x'.repeat(MAX_ODS_CELL_TEXT + 1))))))[0];
    expect(result.rows[0][0]).toHaveLength(MAX_ODS_CELL_TEXT);
    expect(result.truncated).toBe(true);
    const expanded = row(
      cell('x'.repeat(MAX_ODS_CELL_TEXT), 't:number-columns-repeated="100"'),
      't:number-rows-repeated="10"'
    );
    expect(() => parseOdsContent(documentXml(table(expanded)))).toThrow('limit');
    expect(() => parseOdsContent(documentXml(table('').repeat(MAX_ODS_SHEETS + 1)))).toThrow('limit');
  });

  it.each(['0', '-1', 'Infinity', '9007199254740992', '1.5'])(
    'rejects invalid repetition %s instead of shifting cells silently',
    (repeat) => {
      expect(() =>
        parseOdsContent(documentXml(table(row(cell('value', `t:number-columns-repeated="${repeat}"`)))))
      ).toThrow('invalid');
    }
  );

  it('rejects doctypes, malformed XML, wrong document types and excessive nesting', () => {
    expect(() =>
      parseOdsContent(
        '<!DOCTYPE document SYSTEM "https://invalid.example/entity">' + documentXml('').replace(/^<\?xml[^>]+>/, '')
      )
    ).toThrow('unsupported');
    expect(() => parseOdsContent(documentXml(table(row(cell('value')))).slice(0, -8))).toThrow('invalid');
    expect(() => parseOdsContent('<document/>')).toThrow('invalid');
    expect(() => parseOdsContent(documentXml('<x:span>'.repeat(130) + '</x:span>'.repeat(130)))).toThrow('limit');
  });

  it('rejects missing, wrong-type, symlink or normalized-path content entries', async () => {
    const xml = documentXml(table(row(cell('value'))));
    await expect(decodeOds(await encodeZip(new JSZip().file('mimetype', mime)))).rejects.toMatchObject({
      code: 'invalid',
    });
    await expect(decodeOds(await encodeZip(workbook(xml).file('mimetype', 'application/zip')))).rejects.toMatchObject({
      code: 'invalid',
    });
    await expect(
      decodeOds(await encodeZip(workbook(xml).file('content.xml', 'target', { unixPermissions: 0o120777 }), 'UNIX'))
    ).rejects.toMatchObject({ code: 'invalid' });
    const unsafe = new JSZip().file('mimetype', mime).file('folder/../content.xml', xml, { createFolders: false });
    await expect(decodeOds(await encodeZip(unsafe))).rejects.toMatchObject({ code: 'invalid' });
  });

  it('limits actual decompressed XML, input size and corrupt data', async () => {
    const zip = workbook(' '.repeat(MAX_ODS_XML_BYTES + 1));
    await expect(decodeOds(await encodeZip(zip))).rejects.toMatchObject({ code: 'limit' });
    await expect(decodeOds(new ArrayBuffer(MAX_BINARY_PREVIEW_BYTES + 1))).rejects.toMatchObject({ code: 'limit' });
    await expect(decodeOds(new Uint8Array([1, 2, 3]).buffer)).rejects.toThrow();
    const invalidUtf8 = workbook('').file('content.xml', new Uint8Array([0xff]));
    await expect(decodeOds(await encodeZip(invalidUtf8))).rejects.toThrow();
  });

  it('preserves an empty workbook', async () => {
    expect(await decodeOds(await encodeZip(workbook(documentXml(''))))).toEqual([]);
  });
});
