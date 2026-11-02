import JSZip from 'jszip';
import { openEpub, resolveEpubPath } from './epubDecoder';
import { MAX_EPUB_XML_BYTES } from './epubTypes';

const fixture = () => {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file(
    'META-INF/container.xml',
    '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
  );
  zip.file(
    'OPS/book.opf',
    `<package xmlns="http://www.idpf.org/2007/opf"><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">中文电子书</dc:title></metadata>
    <manifest><item id="b" href="text/second.xhtml" media-type="application/xhtml+xml"/><item id="a" href="first.xhtml" media-type="application/xhtml+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover" href="images/cover.png" media-type="image/png"/></manifest>
    <spine><itemref idref="a"/><itemref idref="b"/></spine></package>`
  );
  zip.file(
    'OPS/nav.xhtml',
    '<html xmlns="http://www.w3.org/1999/xhtml"><body><nav><a href="first.xhtml#intro">开始</a><a href="text/second.xhtml">后续</a></nav></body></html>'
  );
  zip.file('OPS/first.xhtml', '<html><body><p>第一章</p></body></html>');
  zip.file('OPS/text/second.xhtml', '<html><body><p>第二章</p><img src="../images/cover.png"/></body></html>');
  zip.file('OPS/images/cover.png', new Uint8Array([1, 2, 3]));
  return zip;
};
const load = (zip: JSZip) => zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' }).then(openEpub);

describe('EPUB archive reader', () => {
  it('uses OPF spine order and directory labels; reads only requested local images', async () => {
    const book = await load(fixture());
    expect(book.info).toEqual({ title: '中文电子书', chapters: [{ name: '开始' }, { name: '后续' }] });
    expect(await book.readChapter(0)).toContain('第一章');
    expect(await book.readChapter(1)).toContain('第二章');
    const images = await book.readImages(1, [
      '../images/cover.png',
      'https://example.com/secret.png',
      '../../../outside.png',
      '../missing.png',
    ]);
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ source: '../images/cover.png', mime: 'image/png' });
    expect(new Uint8Array(images[0].buffer)).toEqual(new Uint8Array([1, 2, 3]));
    expect(() => book.readChapter(-1)).toThrow('invalid');
  });
  it('reads EPUB 2 NCX labels and tolerates a missing optional directory', async () => {
    const zip = fixture();
    let opf = await zip.file('OPS/book.opf')!.async('string');
    opf = opf
      .replace(
        'href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"',
        'href="toc.ncx" media-type="application/x-dtbncx+xml"'
      )
      .replace('<spine>', '<spine toc="nav">');
    zip.file('OPS/book.opf', opf);
    zip.file(
      'OPS/toc.ncx',
      '<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd"><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint><navLabel><text>旧版目录</text></navLabel><content src="first.xhtml"/></navPoint></navMap></ncx>'
    );
    expect((await load(zip)).info.chapters[0].name).toBe('旧版目录');
    zip.remove('OPS/toc.ncx');
    expect((await load(zip)).info.chapters[0].name).toBe('');
  });
  it('preserves mixed inline text order in chapter labels', async () => {
    const zip = fixture();
    zip.file(
      'OPS/nav.xhtml',
      '<html xmlns="http://www.w3.org/1999/xhtml"><body><nav><a href="first.xhtml">第<b>一</b>章</a></nav></body></html>'
    );
    expect((await load(zip)).info.chapters[0].name).toBe('第一章');
  });
  it('caps actual expanded chapter size, and rejects encryption or damaged structure', async () => {
    const zip = fixture();
    zip.file('OPS/first.xhtml', 'x'.repeat(MAX_EPUB_XML_BYTES + 1));
    const book = await load(zip);
    await expect(book.readChapter(0)).rejects.toThrow('limit');
    zip.file('META-INF/encryption.xml', '<encryption/>');
    await expect(load(zip)).rejects.toThrow('unsupported');
    const broken = fixture();
    broken.remove('OPS/book.opf');
    await expect(load(broken)).rejects.toThrow('invalid');
  });
  it('rejects archive traversal, symlink chapters and internal XML entities', async () => {
    const zip = fixture();
    zip.file('OPS/first.xhtml', '../outside', { unixPermissions: 0xa1ff });
    await expect(zip.generateAsync({ type: 'arraybuffer', platform: 'UNIX' }).then(openEpub)).rejects.toThrow(
      'invalid'
    );
    const xml = fixture();
    xml.file('META-INF/container.xml', '<!DOCTYPE container [<!ENTITY x "secret">]><container/>');
    await expect(load(xml)).rejects.toThrow('unsupported');
    for (const href of ['../../private', '/etc/passwd', '%2Fetc/passwd', 'https://example.com', '..\\secret', '%00']) {
      expect(() => resolveEpubPath('OPS/book.opf', href)).toThrow();
    }
    expect(resolveEpubPath('OPS/text/a.xhtml', '../images/%E5%B0%81%E9%9D%A2.png#top')).toBe('OPS/images/封面.png');
  });
});
