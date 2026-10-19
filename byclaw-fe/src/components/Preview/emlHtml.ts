import DOMPurify from 'dompurify';
import type { EmlAttachment } from './emlTypes';

const normalizeCid = (value: string) => {
  try {
    return decodeURIComponent(value.replace(/^cid:/i, '')).replace(/^<|>$/g, '');
  } catch {
    return '';
  }
};

/** 仅解析当前邮件的 CID 位图；远程图片、链接、样式和活动内容不进入阅读 iframe。 */
export function prepareEmlHtml(html: string, attachments: EmlAttachment[]) {
  const fragment = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'div',
      'p',
      'span',
      'br',
      'hr',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
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
      'table',
      'thead',
      'tbody',
      'tfoot',
      'tr',
      'th',
      'td',
      'img',
      'a',
    ],
    ALLOWED_ATTR: ['alt', 'title', 'colspan', 'rowspan', 'src'],
    ALLOWED_URI_REGEXP: /^cid:/i,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  });
  const resources = new Map<string, EmlAttachment>();
  const duplicateIds = new Set<string>();
  attachments.forEach((attachment) => {
    const id = normalizeCid(attachment.contentId || '');
    if (!id) return;
    if (resources.has(id)) duplicateIds.add(id);
    else resources.set(id, attachment);
  });
  let images = 0;
  let bytes = 0;
  const urls = new Map<number, string>();
  fragment.querySelectorAll('img').forEach((element) => {
    const source = element.getAttribute('src') || '';
    element.removeAttribute('src');
    if (!/^cid:/i.test(source) || ++images > 32) return;
    const id = normalizeCid(source);
    const attachment = resources.get(id);
    if (
      !attachment ||
      duplicateIds.has(id) ||
      !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(attachment.mime)
    )
      return;
    if (attachment.buffer.byteLength > 2 * 1024 * 1024) return;
    let url = urls.get(attachment.id);
    if (!url) {
      bytes += attachment.buffer.byteLength;
      if (bytes > 8 * 1024 * 1024) return;
      const data = new Uint8Array(attachment.buffer);
      let binary = '';
      for (let index = 0; index < data.length; index += 8192)
        binary += String.fromCharCode(...data.subarray(index, index + 8192));
      url = `data:${attachment.mime};base64,${btoa(binary)}`;
      urls.set(attachment.id, url);
    }
    element.setAttribute('src', url);
  });
  const body = document.createElement('div');
  body.append(fragment);
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'"><style>body{margin:20px;font:16px/1.7 system-ui,sans-serif;color:#262626;background:white;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid #ddd;padding:6px}pre{white-space:pre-wrap}</style></head><body>${body.innerHTML}</body></html>`;
}
