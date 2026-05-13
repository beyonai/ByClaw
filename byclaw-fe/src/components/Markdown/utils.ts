import { replace, trim } from 'lodash';
import styles from './index.module.less';

/**
 * 处理HTML中的图片URL，添加前缀
 * @param html HTML字符串
 * @returns 处理后的HTML字符串
 */
function processImageUrls(html: string) {
  if (!html) return html;

  // 处理HTML中的img标签
  let h = html.replace(/<img\s+src=["'](\/WaManagerService)/g, '<img src="/byaiService$1');
  h = h.replace(/]\((\/WaManagerService)/g, '](/byaiService$1');
  return h;
}

/**
 * md字符处理，换行符，粗体前后加空格
 * @param str
 * @returns
 */
export function replaceMdString(str: string) {
  if (!str) return '';

  let formatStr = str;
  formatStr = trim(formatStr);

  formatStr = replace(formatStr, /^\\n+|\\n+$/g, '');

  formatStr = replace(formatStr, /(\\n\\n)|(\\n)/g, '\r\n');

  formatStr = formatStr.replace(/\*\*(.*?)\*\*/g, (item) => ` ${item} `);

  formatStr = processImageUrls(formatStr);

  return formatStr;
}

// 获取DOM节点中的所有文本节点内容，忽略特定元素
export function getAllTextContent(element: HTMLElement): string {
  let text = '';

  // 如果是预览按钮，跳过
  if (element.classList.contains(styles.header)) {
    return '';
  }

  // 遍历所有子节点
  for (let i = 0; i < element.childNodes.length; i += 1) {
    const node = element.childNodes[i];
    // 文本节点，直接添加内容
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.nodeValue || '';
    } else if (node.nodeType === Node.ELEMENT_NODE && node instanceof HTMLElement) {
      // 元素节点，递归获取
      // 跳过预览按钮、复制按钮和头部
      if (!(node instanceof HTMLElement && node.classList.contains(styles.header))) {
        text += getAllTextContent(node);
      }
    }
  }

  return text;
}

// HTML转义字符反转义函数
export function unescapeHTML(str: string) {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&nbsp;/g, ' ');
}

// 检测是否为JSON字符串
export function isJsonString(text: string): { isJson: boolean; data?: any } {
  if (!text || typeof text !== 'string') {
    return { isJson: false };
  }

  const trimmedText = text.trim();

  // 检查是否以 { 开头，以 } 结尾，或者以 [ 开头，以 ] 结尾
  if (
    (trimmedText.startsWith('{') && trimmedText.endsWith('}')) ||
    (trimmedText.startsWith('[') && trimmedText.endsWith(']'))
  ) {
    try {
      const parsed = JSON.parse(trimmedText);
      return { isJson: true, data: parsed };
    } catch (error) {
      // JSON解析失败，不是有效的JSON
      return { isJson: false };
    }
  }

  return { isJson: false };
}

export function fixUnclosedCodeBlock(md: string) {
  const codeBlockCount = (md.match(/```/g) || []).length;
  if (codeBlockCount % 2 === 1) {
    return md.concat('\n```');
  }
  return md;
}

/**
 * 替换 Markdown 超链接中 {{file_preview_prefix}} 占位符为真实的文件预览前缀
 * 格式: [链接文字](url)，当 url 包含占位符时进行替换
 * 支持原始形式 {{file_preview_prefix}} 和 URL 编码形式 %7B%7Bfile_preview_prefix%7D%7D
 */
export function replaceFilePrefixInMarkdown(
  text: string,
  replacement: string | ((url: string, regExp: RegExp) => string)
): string {
  if (!replacement) return text;
  const dynamicSymbol = '{{file_preview_prefix}}';
  return text.replace(/\[([^\]]*)\]\(([^)]*)\)/g, (_match, linkText: string, url: string) => {
    const hasRawPlaceholder = url.includes(dynamicSymbol);
    if (hasRawPlaceholder) {
      let newUrl = url;
      if (typeof replacement === 'function') {
        newUrl = replacement(url, new RegExp(dynamicSymbol, 'g'));
      } else {
        newUrl = url.replace(new RegExp(dynamicSymbol, 'g'), replacement);
      }
      return `[${linkText}](${newUrl})`;
    }
    return _match;
  });
}
