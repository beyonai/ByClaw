import { MAX_RTF_BYTES, renderRtf, validateRtf } from './rtfDecoder';

const bytes = (source: string) => Uint8Array.from(source, (character) => character.charCodeAt(0)).buffer;
const rtf = (body: string, codepage = 1252) =>
  bytes(String.raw`{\rtf1\ansi\ansicpg${codepage}{\fonttbl{\f0\fnil Arial;}}\f0 ${body}}`);
const parseHtml = (html: string) => new DOMParser().parseFromString(html, 'text/html');

describe('RTF real parser and isolated static output', () => {
  afterEach(() => jest.restoreAllMocks());

  it('preserves Unicode Chinese and basic emphasis without showing RTF controls', async () => {
    const result = parseHtml(
      await renderRtf(rtf('\\u20013?\\u25991?\\par {\\b Bold} {\\i Italic} {\\ul Underline}'), '图片占位')
    );
    expect(result.body.textContent).toContain('中文');
    expect(result.body.textContent).not.toContain('\\u20013');
    expect(result.querySelector('[style*="font-weight: bold"]')?.textContent).toContain('Bold');
    expect(result.querySelector('[style*="font-style: italic"]')?.textContent).toContain('Italic');
    expect(result.querySelector('[style*="text-decoration: underline"]')?.textContent).toContain('Underline');
  });

  it('decodes ANSI Chinese bytes using the declared code page', async () => {
    const result = parseHtml(await renderRtf(rtf(String.raw`\'d6\'d0\'ce\'c4`, 936), '图片占位'));
    expect(result.body.textContent).toContain('中文');
  });

  it('keeps hyperlink text, ignores external IMPORT and replaces pictures without loading resources', async () => {
    const request = jest.spyOn(XMLHttpRequest.prototype, 'open');
    const content =
      String.raw`Text {\field{\*\fldinst HYPERLINK "https://invalid.example/track"}{\fldrslt Link text}}\par ` +
      String.raw`{\field{\*\fldinst IMPORT "https://invalid.example/image.png"}{\fldrslt }} ` +
      String.raw`{\pict\pngblip 89504e470d0a1a0a} End`;
    const result = parseHtml(await renderRtf(rtf(content), '图片占位'));
    expect(result.body.textContent).toContain('Link text');
    expect(result.body.textContent).toContain('图片占位');
    expect(result.body.textContent).toContain('End');
    expect(result.querySelector('a, img, svg, script, object, iframe, link')).toBeNull();
    expect(request).not.toHaveBeenCalled();
    expect(result.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')).toContain(
      "default-src 'none'"
    );
  });

  it('escapes HTML-looking text and stops if the consumer has already closed', async () => {
    const result = parseHtml(await renderRtf(rtf('<img src=x onerror=alert(1)>'), '图片占位'));
    expect(result.body.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(result.querySelector('img')).toBeNull();
    await expect(renderRtf(rtf('old'), '图片占位', () => false)).rejects.toMatchObject({ code: 'closed' });
  });

  it('validates escaped braces and binary data by byte length', () => {
    expect(() => validateRtf(bytes(String.raw`{\rtf1 escaped \{ \} \\ \bin3 {}\}`))).not.toThrow();
    expect(() => validateRtf(bytes(String.raw`{\rtf1\bin9 {} }`))).toThrow('invalid');
  });

  it.each(['', 'plain text', '{\\rtf2 test}', '{\\rtf1 unclosed', '{\\rtf1 ok}garbage', "{\\rtf1 \\'zz}"])(
    'rejects malformed input %s',
    (source) => expect(() => validateRtf(bytes(source))).toThrow('invalid')
  );

  it('bounds input bytes, nesting, control count and pathological font parameters', () => {
    expect(() => validateRtf(new ArrayBuffer(MAX_RTF_BYTES + 1))).toThrow('limit');
    expect(() => validateRtf(bytes('{\\rtf1 ' + '{'.repeat(128) + 'text' + '}'.repeat(129)))).toThrow('limit');
    expect(() => validateRtf(rtf('\\b '.repeat(20_001)))).toThrow('limit');
    expect(() => validateRtf(rtf('\\f2147483647 text'))).toThrow('limit');
    expect(() => validateRtf(rtf('\\fs2147483647 text'))).toThrow('limit');
  });
});
