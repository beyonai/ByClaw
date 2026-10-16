import { BinaryPreviewError } from './binaryPreview';
import { MAX_EML_BODY_BYTES } from './emlTypes';

// MS-OXRTFCP 规定的 207 字节初始字典；压缩正文在 Worker 内有界展开。
const INITIAL_DICTIONARY =
  '{\\rtf1\\ansi\\mac\\deff0\\deftab720{\\fonttbl;}{\\f0\\fnil \\froman \\fswi' +
  'ss \\fmodern \\fscript \\fdecor MS Sans SerifSymbolArialTimes New Ro' +
  'manCourier{\\colortbl\\red0\\green0\\blue0\r\n\\par \\pard\\plain\\f0\\fs20\\' +
  'b\\i\\u\\tab\\tx';

function crc32(bytes: Uint8Array) {
  // 与常见 ZIP CRC 不同：本协议初值为 0，也不做最终异或。
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return crc >>> 0;
}

/** 校验声明长度、CRC 和字典引用，避免第三方无界数组解压阻塞邮件预览。 */
export function decodeMsgRtf(bytes: Uint8Array): ArrayBuffer {
  if (bytes.length < 16) throw new BinaryPreviewError('invalid');
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = header.getUint32(4, true);
  if (size > MAX_EML_BODY_BYTES || bytes.length > MAX_EML_BODY_BYTES * 2 + 16) throw new BinaryPreviewError('limit');
  if (header.getUint32(0, true) !== bytes.length - 4) throw new BinaryPreviewError('invalid');
  const magic = header.getUint32(8, true);
  const payload = bytes.subarray(16);
  const checksum = header.getUint32(12, true);
  if (magic === 0x414c454d) {
    if (checksum !== 0 || payload.length !== size) throw new BinaryPreviewError('invalid');
    return payload.slice().buffer;
  }
  if (magic !== 0x75465a4c) throw new BinaryPreviewError('unsupported');
  if (crc32(payload) !== checksum) throw new BinaryPreviewError('invalid');
  const output = new Uint8Array(size);
  const dictionary = new Uint8Array(4096);
  dictionary.set(new TextEncoder().encode(INITIAL_DICTIONARY));
  let write = INITIAL_DICTIONARY.length;
  let initialized = write;
  let cursor = 0;
  let written = 0;
  const emit = (value: number) => {
    if (written >= size) throw new BinaryPreviewError('invalid');
    output[written++] = value;
    dictionary[write] = value;
    initialized = Math.max(initialized, write + 1);
    write = (write + 1) & 4095;
  };
  while (cursor < payload.length) {
    const flags = payload[cursor++];
    for (let bit = 0; bit < 8; bit++) {
      if (cursor >= payload.length) throw new BinaryPreviewError('invalid');
      if (flags & (1 << bit)) {
        if (cursor + 2 > payload.length) throw new BinaryPreviewError('invalid');
        const reference = (payload[cursor++] << 8) | payload[cursor++];
        let read = reference >>> 4;
        if (read === write) {
          if (written !== size) throw new BinaryPreviewError('invalid');
          // 终止标记后的填充已纳入 CRC，不再解释为字典引用。
          return output.buffer;
        }
        for (let count = (reference & 15) + 2; count > 0; count--) {
          if (read >= initialized) throw new BinaryPreviewError('invalid');
          emit(dictionary[read]);
          read = (read + 1) & 4095;
        }
      } else emit(payload[cursor++]);
    }
  }
  throw new BinaryPreviewError('invalid');
}
