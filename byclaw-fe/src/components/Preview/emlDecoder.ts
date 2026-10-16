import PostalMime, { type Address } from 'postal-mime';
import { BinaryPreviewError, MAX_BINARY_PREVIEW_BYTES } from './binaryPreview';
import { MAX_EML_ATTACHMENTS, MAX_EML_BODY_BYTES, MAX_EML_HEADERS_BYTES, type EmlContent } from './emlTypes';

/** 邮件附件名仅用于显示/下载，移除路径、控制符和双向覆盖字符，不能作为本地路径使用。 */
export function emlAttachmentName(value?: string | null) {
  return (value || '')
    .split(/[\\/]/)
    .pop()!
    .replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, '')
    .trim()
    .slice(0, 255);
}

function addresses(items?: Address[]): string {
  return (items || [])
    .map((item) => {
      if ('group' in item && item.group) return `${item.name}: ${addresses(item.group)}`;
      const address = 'address' in item ? item.address : '';
      return item.name && address ? `${item.name} <${address}>` : item.name || address || '';
    })
    .join(', ');
}

export async function decodeEml(buffer: ArrayBuffer): Promise<EmlContent> {
  if (!buffer.byteLength) throw new BinaryPreviewError('invalid');
  if (buffer.byteLength > MAX_BINARY_PREVIEW_BYTES) throw new BinaryPreviewError('limit');
  // 在 MIME 解析前保守限制分隔行数量，避免大量空 MIME part；正文中的分隔线也计入预算。
  const raw = new Uint8Array(buffer);
  let boundaries = 0;
  for (let index = 0; index + 1 < raw.length; index++) {
    if ((index === 0 || raw[index - 1] === 10) && raw[index] === 45 && raw[index + 1] === 45 && ++boundaries > 1000)
      throw new BinaryPreviewError('limit');
  }
  let email;
  try {
    email = await PostalMime.parse(buffer, {
      maxNestingDepth: 32,
      maxHeadersSize: MAX_EML_HEADERS_BYTES,
      maxRfc822NestingDepth: 0,
      forceRfc822Attachments: true,
      attachmentEncoding: 'arraybuffer',
    });
  } catch (error) {
    if (error instanceof Error && /maximum|exceed|limit/i.test(error.message)) throw new BinaryPreviewError('limit');
    throw new BinaryPreviewError('invalid');
  }
  if (!email.headers.some(({ key }) => ['subject', 'from', 'to', 'date', 'mime-version', 'content-type'].includes(key)))
    throw new BinaryPreviewError('invalid');
  const contentType = email.headers.find(({ key }) => key === 'content-type')?.value || '';
  if (/^(?:multipart\/encrypted|application\/(?:x-)?pkcs7-mime)\b/i.test(contentType))
    throw new BinaryPreviewError('unsupported');
  const text = email.text || '';
  const html = email.html || '';
  const encoder = new TextEncoder();
  if (
    encoder.encode(text).byteLength + encoder.encode(html).byteLength > MAX_EML_BODY_BYTES ||
    email.attachments.length > MAX_EML_ATTACHMENTS
  )
    throw new BinaryPreviewError('limit');
  let attachmentBytes = 0;
  const attachments = email.attachments.map((attachment, id) => {
    const content = attachment.content;
    let bytes: ArrayBuffer;
    if (content instanceof ArrayBuffer) bytes = content;
    else if (ArrayBuffer.isView(content))
      bytes = new Uint8Array(content.buffer, content.byteOffset, content.byteLength).slice().buffer;
    else throw new BinaryPreviewError('invalid');
    attachmentBytes += bytes.byteLength;
    if (attachmentBytes > MAX_BINARY_PREVIEW_BYTES) throw new BinaryPreviewError('limit');
    return {
      id,
      name: emlAttachmentName(attachment.filename),
      mime: attachment.mimeType.toLowerCase(),
      contentId: attachment.contentId,
      buffer: bytes,
    };
  });
  return {
    subject: email.subject || '',
    from: addresses(email.from ? [email.from] : []),
    to: addresses(email.to),
    cc: addresses(email.cc),
    date: email.date || '',
    text,
    html,
    attachments,
  };
}
