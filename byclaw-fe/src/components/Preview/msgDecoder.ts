import MsgReader, { type FieldsData } from '@kenjiuno/msgreader';
import { Reader, type CFolder } from '@kenjiuno/msgreader/lib/Reader';
import { BinaryPreviewError, MAX_BINARY_PREVIEW_BYTES } from './binaryPreview';
import { emlAttachmentName } from './emlDecoder';
import { getPreviewMimeType } from './formats';
import { MAX_EML_ATTACHMENTS, MAX_EML_BODY_BYTES, type EmlContent } from './emlTypes';
import { decodeMsgRtf } from './msgRtfDecoder';

const codepages: Record<number, string> = {
  65001: 'utf-8',
  1200: 'utf-16le',
  1201: 'utf-16be',
  936: 'gbk',
  54936: 'gb18030',
  950: 'big5',
  932: 'shift_jis',
  949: 'euc-kr',
  1250: 'windows-1250',
  1251: 'windows-1251',
  1252: 'windows-1252',
  1253: 'windows-1253',
  1254: 'windows-1254',
  1255: 'windows-1255',
  1256: 'windows-1256',
  1257: 'windows-1257',
  1258: 'windows-1258',
  20127: 'ascii',
  28591: 'iso-8859-1',
};

/** MSG 是 CFB 容器；在库按流声明分配内存前校验头、目录深度和流大小。 */
export function inspectMsg(buffer: ArrayBuffer) {
  if (buffer.byteLength > MAX_BINARY_PREVIEW_BYTES) throw new BinaryPreviewError('limit');
  const signature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (buffer.byteLength < 512 || !signature.every((byte, index) => new Uint8Array(buffer)[index] === byte))
    throw new BinaryPreviewError('invalid');
  const view = new DataView(buffer);
  const version = view.getUint16(26, true);
  const shift = view.getUint16(30, true);
  if (
    view.getUint16(28, true) !== 0xfffe ||
    !((version === 3 && shift === 9) || (version === 4 && shift === 12)) ||
    view.getUint16(32, true) !== 6 ||
    view.getUint32(56, true) !== 4096
  )
    throw new BinaryPreviewError('invalid');
  const sectors = Math.floor(buffer.byteLength / 2 ** shift) - 1;
  if (sectors < 1 || [44, 64, 72].some((offset) => view.getUint32(offset, true) > sectors))
    throw new BinaryPreviewError('invalid');
  const reader = new Reader(buffer);
  reader.parse();
  const root = reader.rootFolder();
  // 同样的 CFB 签名也用于 DOC/XLS，不能仅靠扩展名把任意 CFB 当作邮件。
  if (!root.fileNames().includes('__properties_version1.0')) throw new BinaryPreviewError('invalid');
  const seen = new Set<number>();
  let count = 0;
  let total = 0;
  const visit = (folder: CFolder, depth: number) => {
    if (depth > 32 || ++count > 10000) throw new BinaryPreviewError('limit');
    if (seen.has(folder.dataId)) throw new BinaryPreviewError('invalid');
    seen.add(folder.dataId);
    for (const stream of folder.fileNameSets()) {
      if (++count > 10000 || !Number.isSafeInteger(stream.length) || stream.length < 0)
        throw new BinaryPreviewError('limit');
      total += stream.length;
      if (stream.length > buffer.byteLength || total > 50 * 1024 * 1024) throw new BinaryPreviewError('limit');
    }
    folder.subFolders().forEach((child) => visit(child, depth + 1));
  };
  visit(root, 0);
  // PT_STRING8 正文/主题遵循邮件的代码页，避免 ANSI 中文邮件按默认西文解码。
  const properties = root.readFile('__properties_version1.0');
  if (!properties || properties.byteLength < 32) throw new BinaryPreviewError('invalid');
  const props = new DataView(properties.buffer, properties.byteOffset, properties.byteLength);
  let codepage: number | undefined;
  for (let offset = 32; offset + 16 <= props.byteLength; offset += 16) {
    if (props.getUint32(offset, true) === 0x3ffd0003) codepage = props.getUint32(offset + 8, true);
  }
  if (codepage && !codepages[codepage]) throw new BinaryPreviewError('unsupported');
  return codepage ? codepages[codepage] : undefined;
}

const address = (name?: string, email?: string) => (name && email ? `${name} <${email}>` : name || email || '');

export function decodeMsg(buffer: ArrayBuffer): EmlContent {
  const ansiEncoding = inspectMsg(buffer);
  const reader = new MsgReader(buffer);
  reader.parserConfig = { ansiEncoding };
  const email = reader.getFileData();
  if (email.error || email.dataType !== 'msg') throw new BinaryPreviewError('invalid');
  if (email.messageClass && (!/^IPM\.Note(?:\.|$)/i.test(email.messageClass) || /SMIME/i.test(email.messageClass)))
    throw new BinaryPreviewError('unsupported');
  const text = email.body || '';
  let html = email.bodyHtml || '';
  if (!html && email.html?.length) {
    if (email.html.length > MAX_EML_BODY_BYTES) throw new BinaryPreviewError('limit');
    const cp = email.internetCodepage || email.messageCodepage;
    if (cp && !codepages[cp]) throw new BinaryPreviewError('unsupported');
    html = new TextDecoder(cp ? codepages[cp] : 'utf-8').decode(email.html);
  }
  const encoder = new TextEncoder();
  if (
    encoder.encode(text).length + encoder.encode(html).length > MAX_EML_BODY_BYTES ||
    (email.attachments?.length || 0) > MAX_EML_ATTACHMENTS ||
    (email.recipients?.length || 0) > 1000
  )
    throw new BinaryPreviewError('limit');
  let total = 0;
  const attachments = (email.attachments || []).map((attachment, id) => {
    // 引用型附件只有路径，不访问文件系统或网络；明确保留一个不可下载的附件条目。
    const unavailable = !attachment.innerMsgContent && typeof attachment.dataId !== 'number';
    if ((attachment.contentLength || 0) > MAX_BINARY_PREVIEW_BYTES) throw new BinaryPreviewError('limit');
    const decoded = unavailable ? undefined : reader.getAttachment(attachment);
    const bytes = decoded?.content || new Uint8Array();
    total += bytes.byteLength;
    if (total > MAX_BINARY_PREVIEW_BYTES) throw new BinaryPreviewError('limit');
    const name = emlAttachmentName(
      decoded?.fileName || attachment.fileName || attachment.fileNameShort || attachment.name
    );
    return {
      id,
      name,
      unavailable,
      mime: (attachment.attachMimeTag || getPreviewMimeType(name) || 'application/octet-stream')
        .toLowerCase()
        .split(';')[0],
      contentId: attachment.pidContentId,
      // 复制独立缓冲区，向主线程转移附件时不分离 MSG 解析器仍在使用的源数据。
      buffer: bytes.slice().buffer as ArrayBuffer,
    };
  });
  const recipients = (kind: 'to' | 'cc') =>
    (email.recipients || [])
      .filter((recipient: FieldsData) => recipient.recipType === kind || (kind === 'to' && !recipient.recipType))
      .map((recipient) => address(recipient.name, recipient.smtpAddress || recipient.email))
      .join(', ');
  let rtf: ArrayBuffer | undefined;
  let bodyUnavailable = false;
  if (!text && !html && email.compressedRtf?.length) {
    try {
      rtf = decodeMsgRtf(email.compressedRtf);
    } catch {
      // 正文损坏或超限不影响查看邮件头和下载独立附件。
      bodyUnavailable = true;
    }
  }
  return {
    subject: email.subject || '',
    from: address(email.senderName, email.senderSmtpAddress || email.senderEmail),
    to: recipients('to'),
    cc: recipients('cc'),
    date: email.clientSubmitTime || email.messageDeliveryTime || '',
    text,
    html,
    attachments,
    rtf,
    bodyUnavailable,
  };
}
