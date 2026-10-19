import JSZip from 'jszip';
import { decodeOpenDocument, parseOpenDocument } from './openDocumentDecoder';
import { MAX_ODF_PAGES, MAX_ODF_XML_BYTES } from './openDocumentTypes';

const content = (body: string, type = 'odt') => `<?xml version="1.0"?><o:document-content
 xmlns:o="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
 xmlns:t="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
 xmlns:d="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"
 xmlns:b="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
 xmlns:x="http://www.w3.org/1999/xlink">
 <o:body><o:${type === 'odt' ? 'text' : 'presentation'}>${body}</o:${
  type === 'odt' ? 'text' : 'presentation'
}></o:body></o:document-content>`;
const archive = (xml: string, type = 'odt') =>
  new JSZip()
    .file('mimetype', `application/vnd.oasis.opendocument.${type === 'odt' ? 'text' : 'presentation'}`)
    .file('content.xml', xml);

describe('OpenDocument static preview', () => {
  it('reads namespaced headings, whitespace, lists and tables in document order', async () => {
    const xml = content(
      '<t:h t:outline-level="2">标题</t:h><t:p>A<t:s t:c="2"/>B<t:tab/>C<t:line-break/>D &lt;script&gt;</t:p><t:list><t:list-item><t:p>item</t:p></t:list-item></t:list><b:table><b:table-row><b:table-cell><t:p>cell</t:p></b:table-cell></b:table-row></b:table>'
    );
    const result = await decodeOpenDocument(await archive(xml).generateAsync({ type: 'arraybuffer' }), 'odt');
    expect(result.pages[0].html).toBe(
      '<h2>标题</h2><p>A  B\tC<br>D &lt;script&gt;</p><ul><li><p>item</p></li></ul><table><tr><td><p>cell</p></td></tr></table>'
    );
    expect(result.omitted).toBe(false);
  });

  it('keeps slides separate and excludes notes/embedded objects from visible text', async () => {
    const xml = content(
      '<d:page d:name="首页"><d:frame><d:text-box><t:p>first</t:p></d:text-box></d:frame><d:object><t:p>hidden</t:p></d:object></d:page><d:page d:name="第二页"><t:p>second</t:p></d:page>',
      'odp'
    );
    const result = await decodeOpenDocument(await archive(xml, 'odp').generateAsync({ type: 'arraybuffer' }), 'odp');
    expect(result.pages).toEqual([
      { name: '首页', html: '<p>first</p>' },
      { name: '第二页', html: '<p>second</p>' },
    ]);
    expect(result.omitted).toBe(true);
  });

  it('embeds only packaged raster images and drops remote, traversal and missing references', async () => {
    const xml = content(
      '<t:p>photo</t:p><d:image x:href="Pictures/a.png"/><d:image x:href="https://example.com/a.png"/><d:image x:href="../a.png"/><d:image x:href="missing.jpg"/>'
    );
    const zip = archive(xml).file('Pictures/a.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]));
    const result = await decodeOpenDocument(await zip.generateAsync({ type: 'arraybuffer' }), 'odt');
    expect(result.pages[0].html).toContain('src="data:image/png;base64,');
    expect(result.pages[0].html).not.toMatch(/https:|\.\.\/|missing|<!--/);
    expect(result.omitted).toBe(true);
  });

  it('does not expand repeated cells and reports incomplete table structure', () => {
    const result = parseOpenDocument(
      content(
        '<b:table><b:table-row><b:table-cell b:number-columns-repeated="999999999"><t:p>one</t:p></b:table-cell></b:table-row></b:table>'
      ),
      'odt'
    ).result;
    expect(result.pages[0].html).toBe('<table><tr><td><p>one</p></td></tr></table>');
    expect(result.omitted).toBe(true);
  });

  it('rejects wrong MIME, missing body, malformed XML and DTDs', async () => {
    const buffer = await archive(content('<t:p>text</t:p>')).generateAsync({ type: 'arraybuffer' });
    await expect(decodeOpenDocument(buffer, 'odp')).rejects.toMatchObject({ code: 'invalid' });
    expect(() => parseOpenDocument('<root/>', 'odt')).toThrow();
    expect(() => parseOpenDocument(content('<t:p>'), 'odt')).toThrow();
    expect(() => parseOpenDocument('<!DOCTYPE x>' + content('<t:p>text</t:p>'), 'odt')).toThrow('unsupported');
  });

  it('bounds slides, nesting, text repeats and expanded ZIP content', async () => {
    expect(() => parseOpenDocument(content('<d:page/>'.repeat(MAX_ODF_PAGES + 1), 'odp'), 'odp')).toThrow('limit');
    expect(() => parseOpenDocument(content('<t:span>'.repeat(130) + '</t:span>'.repeat(130)), 'odt')).toThrow('limit');
    expect(() => parseOpenDocument(content('<t:p><t:s t:c="1000000000"/></t:p>'), 'odt')).toThrow('limit');
    const zip = archive('x'.repeat(MAX_ODF_XML_BYTES + 1));
    await expect(
      decodeOpenDocument(await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' }), 'odt')
    ).rejects.toMatchObject({ code: 'limit' });
  });

  it('rejects normalized traversal entries instead of reading them as content.xml', async () => {
    const zip = archive(content('<t:p>safe</t:p>'))
      .remove('content.xml')
      .file('../content.xml', content('<t:p>unsafe</t:p>'));
    await expect(decodeOpenDocument(await zip.generateAsync({ type: 'arraybuffer' }), 'odt')).rejects.toMatchObject({
      code: 'invalid',
    });
  });
});
