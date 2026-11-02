import DOMPurify from 'dompurify';
import { MAX_EPUB_IMAGES, type EpubImage } from './epubTypes';

/** 章节是附件内容：只保留阅读所需标签，所有资源都由压缩包白名单提供。 */
export function prepareEpubChapter(html: string) {
  const fragment = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'div',
      'section',
      'article',
      'p',
      'span',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'br',
      'hr',
      'b',
      'strong',
      'i',
      'em',
      'u',
      's',
      'small',
      'sup',
      'sub',
      'blockquote',
      'pre',
      'code',
      'ul',
      'ol',
      'li',
      'dl',
      'dt',
      'dd',
      'table',
      'thead',
      'tbody',
      'tfoot',
      'tr',
      'th',
      'td',
      'caption',
      'figure',
      'figcaption',
      'img',
      'a',
    ],
    ALLOWED_ATTR: ['alt', 'title', 'colspan', 'rowspan', 'src'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  });
  const images = Array.from(fragment.querySelectorAll('img')).map((element) => {
    const source = element.getAttribute('src') || '';
    element.removeAttribute('src');
    return { element, source };
  });
  const sources = [...new Set(images.map(({ source }) => source).filter(Boolean))].slice(0, MAX_EPUB_IMAGES);
  return {
    sources,
    render(resources: EpubImage[]) {
      const urls = new Map<string, string>(
        resources.map(({ source, mime, buffer }) => {
          // 仅来自 worker 校验过的归档图片；data URL 不会访问远程地址，也无需生命周期回收。
          let binary = '';
          const bytes = new Uint8Array(buffer);
          for (let offset = 0; offset < bytes.length; offset += 8192) {
            binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
          }
          return [source, `data:${mime};base64,${btoa(binary)}`];
        })
      );
      images.forEach(({ element, source }) => {
        const url = urls.get(source);
        if (url) element.setAttribute('src', url);
      });
      const body = document.createElement('div');
      body.append(fragment);
      return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'"><style>body{margin:24px auto;padding:0 20px;max-width:800px;line-height:1.8;font-family:system-ui,sans-serif;overflow-wrap:anywhere;color:#262626;background:white}img{max-width:100%;height:auto}table{max-width:100%;border-collapse:collapse}td,th{border:1px solid #ddd;padding:4px 8px}pre{white-space:pre-wrap}a{color:inherit}</style></head><body>${body.innerHTML}</body></html>`;
    },
  };
}
