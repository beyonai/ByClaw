import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  getSlateKatexAssetName,
  injectSlateKatexPrefetch,
  injectSlateKatexPrefetchToHtmlFiles,
} from '../slateKatexPrefetch';

describe('slateKatexPrefetch', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slate-katex-prefetch-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { force: true, recursive: true });
  });

  it('finds the webpack contenthash asset emitted for the etag chunk', () => {
    fs.writeFileSync(path.join(tempDir, 'etag.slate-katex.1234abcd.js'), '');
    fs.writeFileSync(path.join(tempDir, 'etag.js'), '');

    expect(getSlateKatexAssetName(tempDir)).toBe('etag.slate-katex.1234abcd.js');
  });

  it('injects the prefetch link once before the closing head tag', () => {
    const html = '<html><head><title>app</title></head><body></body></html>';
    const href = '/app/etag.slate-katex.1234abcd.js';

    const nextHtml = injectSlateKatexPrefetch(html, href);

    expect(nextHtml).toContain(`<link href="${href}" rel="prefetch">\n</head>`);
    expect(injectSlateKatexPrefetch(nextHtml, href)).toBe(nextHtml);
  });

  it('injects the actual etag asset into every built html file', () => {
    const nestedDir = path.join(tempDir, 'manager');
    fs.mkdirSync(nestedDir);
    fs.writeFileSync(path.join(tempDir, 'etag.slate-katex.1234abcd.js'), '');
    fs.writeFileSync(path.join(tempDir, 'index.html'), '<html><head></head><body></body></html>');
    fs.writeFileSync(path.join(nestedDir, 'index.html'), '<html><head></head><body></body></html>');

    const changedFiles = injectSlateKatexPrefetchToHtmlFiles(tempDir, '/portal');

    expect(changedFiles).toHaveLength(2);
    expect(fs.readFileSync(path.join(tempDir, 'index.html'), 'utf8')).toContain(
      '<link href="/portal/etag.slate-katex.1234abcd.js" rel="prefetch">'
    );
    expect(fs.readFileSync(path.join(nestedDir, 'index.html'), 'utf8')).toContain(
      '<link href="/portal/etag.slate-katex.1234abcd.js" rel="prefetch">'
    );
  });
});
