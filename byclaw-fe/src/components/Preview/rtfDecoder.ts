import DOMPurify from 'dompurify';
import { BinaryPreviewError } from './binaryPreview';

export const MAX_RTF_BYTES = 2 * 1024 * 1024;
const MAX_RTF_CONTROLS = 20_000;
const isLetter = (value: number) => (value >= 65 && value <= 90) || (value >= 97 && value <= 122);
const isDigit = (value: number) => value >= 48 && value <= 57;

/** 在同步 DOM 解析前限制复杂度；bin 段必须按字节跳过，不能把图片里的括号当成分组。 */
export function validateRtf(buffer: ArrayBuffer) {
  if (!buffer.byteLength) throw new BinaryPreviewError('invalid');
  if (buffer.byteLength > MAX_RTF_BYTES) throw new BinaryPreviewError('limit');
  const bytes = new Uint8Array(buffer);
  const signature = String.fromCharCode(...bytes.subarray(0, 32));
  if (!/^\{\\rtf1(?=[\\\s{}])/.test(signature)) throw new BinaryPreviewError('invalid');
  let depth = 0;
  let controls = 0;
  for (let index = 0; index < bytes.length; ) {
    const value = bytes[index++];
    if (value === 123) {
      if (++depth > 128 || ++controls > MAX_RTF_CONTROLS) throw new BinaryPreviewError('limit');
    } else if (value === 125) {
      if (--depth < 0) throw new BinaryPreviewError('invalid');
      if (depth === 0) {
        if (bytes.subarray(index).some((byte) => ![9, 10, 13, 32].includes(byte)))
          throw new BinaryPreviewError('invalid');
        return;
      }
    } else if (value === 92) {
      if (++controls > MAX_RTF_CONTROLS) throw new BinaryPreviewError('limit');
      if (index >= bytes.length) throw new BinaryPreviewError('invalid');
      if (bytes[index] === 39) {
        const hex = String.fromCharCode(...bytes.subarray(index + 1, index + 3));
        if (!/^[\da-f]{2}$/i.test(hex)) throw new BinaryPreviewError('invalid');
        index += 3;
      } else if (!isLetter(bytes[index])) {
        index++;
      } else {
        const start = index;
        while (isLetter(bytes[index])) index++;
        if (index - start > 32) throw new BinaryPreviewError('invalid');
        const keyword = String.fromCharCode(...bytes.subarray(start, index));
        const numberStart = index;
        if (bytes[index] === 45) index++;
        while (isDigit(bytes[index])) index++;
        if (index - numberStart > 11) throw new BinaryPreviewError('limit');
        const parameter = String.fromCharCode(...bytes.subarray(numberStart, index));
        // 异常字体编号/尺寸会生成巨大的稀疏表或布局；超出正文预览范围时保留下载。
        if (['f', 'deff', 'af', 'fs', 'afs'].includes(keyword) && Math.abs(Number(parameter)) > 10_000) {
          throw new BinaryPreviewError('limit');
        }
        if (bytes[index] === 32) index++;
        if (keyword === 'bin') {
          const count = Number(parameter);
          if (!/^\d+$/.test(parameter) || !Number.isSafeInteger(count) || count > bytes.length - index) {
            throw new BinaryPreviewError('invalid');
          }
          index += count;
        }
      }
    }
  }
  throw new BinaryPreviewError('invalid');
}

export async function renderRtf(buffer: ArrayBuffer, pictureLabel: string, isActive: () => boolean = () => true) {
  validateRtf(buffer);
  // 使用可被 Jest 与 webpack 同时加载的 UMD 入口，避免影响原有 Office 预览链路。
  const RTFJS = await import('rtf.js/dist/RTFJS.bundle.js');
  if (!isActive()) throw new BinaryPreviewError('closed');
  RTFJS.loggingEnabled(false);
  const doc = new RTFJS.Document(buffer, {
    onHyperlink: () => {
      const span = document.createElement('span');
      return { element: span, content: span };
    },
    onPicture: () => {
      // 不调用图片渲染回调，避免展开 WMF/EMF 或嵌入对象；正文位置保留说明。
      const span = document.createElement('span');
      span.textContent = pictureLabel;
      return span;
    },
    // 不提供 onImport：库会忽略 IMPORT 字段，不发起外部资源请求。
  });
  const nodes = await doc.render();
  if (!isActive()) throw new BinaryPreviewError('closed');
  const wrapper = document.createElement('div');
  nodes.forEach((node) => wrapper.appendChild(node));
  if (wrapper.querySelectorAll('*').length > 40_000 || wrapper.innerHTML.length > 8 * 1024 * 1024) {
    throw new BinaryPreviewError('limit');
  }
  const clean = DOMPurify.sanitize(wrapper.innerHTML, {
    ALLOWED_TAGS: ['div', 'p', 'span', 'br', 'b', 'i', 'u', 's', 'em', 'strong', 'sup', 'sub'],
    ALLOWED_ATTR: ['style'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
  // 样式只在无脚本、无网络权限的 iframe 内生效，不能覆盖宿主界面或请求外部字体。
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'\">" +
    '<style>body{margin:16px;overflow-wrap:anywhere;font-family:Arial,sans-serif}div,p{max-width:100%;box-sizing:border-box}</style>' +
    `</head><body>${clean}</body></html>`
  );
}
