import DOMPurify from 'dompurify';

/** 附件只允许静态正文与内嵌位图，阻止链接导航、脚本和远程资源请求。 */
export function staticPreviewHtml(html: string) {
  const fragment = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p',
      'span',
      'div',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'br',
      'ul',
      'ol',
      'li',
      'table',
      'tbody',
      'tr',
      'td',
      'th',
      'img',
    ],
    ALLOWED_ATTR: ['src', 'alt'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  });
  fragment.querySelectorAll('img').forEach((element) => {
    if (!/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(element.getAttribute('src') || '')) {
      element.removeAttribute('src');
    }
  });
  const body = document.createElement('div');
  body.append(fragment);
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'"><style>body{margin:24px;font:16px/1.7 system-ui,sans-serif;color:#262626;background:white;overflow-wrap:anywhere}p,li{white-space:pre-wrap}img{max-width:100%;height:auto}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid #ddd;padding:6px;white-space:pre-wrap}</style></head><body>${body.innerHTML}</body></html>`;
}
