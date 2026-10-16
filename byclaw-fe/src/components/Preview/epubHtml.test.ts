import { prepareEpubChapter } from './epubHtml';

describe('EPUB chapter isolation', () => {
  it('retains text, tables and local images but disables scripts, navigation, styles and remote resources', () => {
    const source = `<h1 onclick="alert(1)">章节</h1><script>parent.alert(1)</script><base href="https://evil.example">
      <meta http-equiv="refresh" content="0;url=https://evil.example"><style>@import 'https://evil.example';</style>
      <a href="https://evil.example">链接文字</a><form action="/delete"><input></form><iframe src="/private"></iframe>
      <img src="images/a.png" srcset="https://evil.example/a 2x" onerror="alert(1)"><img src="https://evil.example/b">
      <table><tr><td colspan="2">单元格</td></tr></table>`;
    const chapter = prepareEpubChapter(source);
    const html = chapter.render([
      { source: 'images/a.png', mime: 'image/png', buffer: new Uint8Array([1, 2, 3]).buffer },
    ]);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelector('h1')?.textContent).toBe('章节');
    expect(doc.querySelector('td')?.getAttribute('colspan')).toBe('2');
    expect(doc.querySelector('a')?.textContent).toBe('链接文字');
    expect(doc.querySelector('a')?.hasAttribute('href')).toBe(false);
    expect(doc.querySelector('img')?.src).toBe('data:image/png;base64,AQID');
    expect(doc.querySelectorAll('img')[1].hasAttribute('src')).toBe(false);
    expect(doc.querySelector('script, iframe, form, base, [onclick], [onerror], [srcset]')).toBeNull();
    expect(html).not.toContain('https://evil.example');
    expect(doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')).toContain(
      "default-src 'none'"
    );
  });
  it('limits image requests and removes all unloaded image sources', () => {
    const prepared = prepareEpubChapter(Array.from({ length: 100 }, (_, i) => `<img src="${i}.png">`).join(''));
    expect(prepared.sources).toHaveLength(32);
    expect(prepared.render([])).not.toMatch(/src=/);
  });
});
