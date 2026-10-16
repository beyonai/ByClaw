/** @jest-environment node */
import { burn, type Entry } from '@kenjiuno/msgreader/lib/Burner';
import { TypeEnum } from '@kenjiuno/msgreader/lib/Reader';
import { decodeMsg, inspectMsg } from './msgDecoder';
import { MAX_BINARY_PREVIEW_BYTES } from './binaryPreview';
import { MAX_EML_BODY_BYTES } from './emlTypes';

// 由结构化流生成真实 CFB/MSG，避免只 mock 解析库而遗漏目录、Unicode 和附件映射。
const utf16 = (value: string) => new Uint8Array(Buffer.from(value + '\0', 'utf16le'));
const utf8 = (value: string) => new TextEncoder().encode(value);
function message(
  options: {
    ansi?: boolean;
    body?: string;
    className?: string;
    linked?: boolean;
    rtfOnly?: boolean;
    rtf?: Uint8Array;
    manyAttachments?: boolean;
  } = {}
) {
  const entries: Entry[] = [{ name: 'Root Entry', type: TypeEnum.ROOT, length: 0, children: [] }];
  const add = (parent: number, name: string, bytes?: Uint8Array) => {
    const id = entries.length;
    entries[parent].children!.push(id);
    entries.push(
      bytes
        ? { name, type: TypeEnum.DOCUMENT, length: bytes.length, binaryProvider: () => bytes }
        : { name, type: TypeEnum.DIRECTORY, length: 0, children: [] }
    );
    return id;
  };
  const fixed = (header: number, tag?: number, value = 0) => {
    const bytes = new Uint8Array(header + (tag ? 16 : 0));
    if (tag) {
      const view = new DataView(bytes.buffer);
      view.setUint32(header, tag, true);
      view.setUint32(header + 8, value, true);
    }
    return bytes;
  };
  add(0, '__properties_version1.0', fixed(32, options.ansi ? 0x3ffd0003 : undefined, 936));
  add(0, '__substg1.0_001A001F', utf16(options.className || 'IPM.Note'));
  add(
    0,
    options.ansi ? '__substg1.0_0037001E' : '__substg1.0_0037001F',
    options.ansi ? new Uint8Array([0xd6, 0xd0, 0xce, 0xc4, 0]) : utf16('中文邮件')
  );
  add(0, '__substg1.0_0C1A001F', utf16('发件人'));
  add(0, '__substg1.0_5D01001F', utf16('sender@example.com'));
  if (options.rtfOnly || options.rtf) add(0, '__substg1.0_10090102', options.rtf || new Uint8Array([1, 2, 3]));
  else {
    add(0, '__substg1.0_1000001F', utf16(options.body || '纯文本正文'));
    add(0, '__substg1.0_10130102', utf8('<p>邮件正文<img src="cid:image1"></p>'));
  }
  for (const [index, kind] of [1, 2].entries()) {
    const id = add(0, `__recip_version1.0_#${index.toString(16).padStart(8, '0')}`);
    add(id, '__properties_version1.0', fixed(8, 0x0c150003, kind));
    add(id, '__substg1.0_3001001F', utf16(kind === 1 ? '收件人' : '抄送人'));
    add(id, '__substg1.0_39FE001F', utf16(kind === 1 ? 'to@example.com' : 'cc@example.com'));
  }
  for (let index = 0; index < (options.manyAttachments ? 101 : 1); index++) {
    const id = add(0, `__attach_version1.0_#${index.toString(16).padStart(8, '0')}`);
    add(id, '__properties_version1.0', fixed(8, 0x37050003, options.linked ? 2 : 1));
    add(id, '__substg1.0_3707001F', utf16('../图片.png'));
    add(id, '__substg1.0_370E001F', utf16('image/png'));
    add(id, '__substg1.0_3712001F', utf16('image1'));
    if (!options.linked) add(id, '__substg1.0_37010102', new Uint8Array([1, 2, 3]));
  }
  return burn(entries).slice().buffer as ArrayBuffer;
}

describe('MSG decoding', () => {
  it('reads Chinese metadata, separate To/Cc, HTML CID and attachment bytes without changing the source', () => {
    const source = message();
    const original = new Uint8Array(source).slice();
    const result = decodeMsg(source);
    expect(result.subject).toBe('中文邮件');
    expect(result.from).toBe('发件人 <sender@example.com>');
    expect(result.to).toBe('收件人 <to@example.com>');
    expect(result.cc).toBe('抄送人 <cc@example.com>');
    expect(result.text).toBe('纯文本正文');
    expect(result.html).toContain('cid:image1');
    expect(result.attachments[0]).toMatchObject({
      name: '图片.png',
      mime: 'image/png',
      contentId: 'image1',
      unavailable: false,
    });
    expect(new Uint8Array(result.attachments[0].buffer)).toEqual(new Uint8Array([1, 2, 3]));
    expect(new Uint8Array(source)).toEqual(original);
  });
  it('uses the MSG codepage for ANSI Chinese subjects', () => {
    expect(decodeMsg(message({ ansi: true })).subject).toBe('中文');
  });
  it('keeps linked attachments unavailable and marks damaged RTF without losing metadata', () => {
    const result = decodeMsg(message({ linked: true, rtfOnly: true }));
    expect(result.bodyUnavailable).toBe(true);
    expect(result.subject).toBe('中文邮件');
    expect(result.attachments[0].unavailable).toBe(true);
    expect(result.attachments[0].buffer.byteLength).toBe(0);
  });
  it('decodes an RTF-only MSG and retains downloadable attachments', () => {
    const rtf = new Uint8Array(
      Buffer.from(
        '2d0000002b0000004c5a4675f1c5c7a703000a007263706731323542320af32068656c090020627705b06c647d0a800fa0',
        'hex'
      )
    );
    const result = decodeMsg(message({ rtf }));
    expect(new TextDecoder().decode(result.rtf)).toContain('hello');
    expect(result.bodyUnavailable).toBe(false);
    expect(new Uint8Array(result.attachments[0].buffer)).toEqual(new Uint8Array([1, 2, 3]));
    new DataView(rtf.buffer).setUint32(4, MAX_EML_BODY_BYTES + 1, true);
    const limited = decodeMsg(message({ rtf }));
    expect(limited.bodyUnavailable).toBe(true);
    expect(limited.attachments[0].unavailable).toBe(false);
  });
  it.each(['IPM.Note.SMIME', 'IPM.Contact', 'IPM.Appointment'])(
    'rejects encrypted/non-email Outlook item %s',
    (className) => {
      expect(() => decodeMsg(message({ className }))).toThrow('unsupported');
    }
  );
  it('bounds input, body and attachments', () => {
    expect(() => decodeMsg(new ArrayBuffer(MAX_BINARY_PREVIEW_BYTES + 1))).toThrow('limit');
    expect(() => decodeMsg(message({ body: 'a'.repeat(MAX_EML_BODY_BYTES + 1) }))).toThrow('limit');
    expect(() => decodeMsg(message({ manyAttachments: true }))).toThrow('limit');
  });
  it('rejects renamed text and invalid sector allocation before parsing streams', () => {
    expect(() => inspectMsg(new ArrayBuffer(512))).toThrow('invalid');
    const source = message();
    new DataView(source).setUint32(44, 0xffffffff, true);
    expect(() => inspectMsg(source)).toThrow('invalid');
  });
  it('rejects forged stream lengths before the decoder allocates them', () => {
    const source = message();
    const view = new DataView(source);
    const directory = (view.getUint32(48, true) + 1) * 512;
    // Root 的第一个子流是 __properties_version1.0；伪造长度不能触发超大 Uint8Array。
    view.setUint32(directory + 128 + 120, 0x7fffffff, true);
    expect(() => inspectMsg(source)).toThrow('limit');
  });
});
