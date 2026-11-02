import { decodeEml, emlAttachmentName } from './emlDecoder';
import { MAX_BINARY_PREVIEW_BYTES } from './binaryPreview';
import { MAX_EML_BODY_BYTES } from './emlTypes';

const bytes = (source: string) => new TextEncoder().encode(source.replace(/\n/g, '\r\n')).buffer as ArrayBuffer;

describe('EML MIME decoding', () => {
  it('decodes Chinese encoded headers, recipients and quoted-printable body', async () => {
    const email = await decodeEml(
      bytes(
        'From: =?UTF-8?B?5Lit5paH?= <sender@example.com>\nTo: Team: A <a@example.com>, B <b@example.com>;\nCc: c@example.com\nSubject: =?UTF-8?B?5Lit5paH?=\nDate: Fri, 16 Oct 2026 10:00:00 +0800\nContent-Type: text/plain; charset=utf-8\nContent-Transfer-Encoding: quoted-printable\n\n=E4=BD=A0=E5=A5=BD'
      )
    );
    expect(email.subject).toBe('中文');
    expect(email.from).toBe('中文 <sender@example.com>');
    expect(email.to).toContain('a@example.com');
    expect(email.to).toContain('b@example.com');
    expect(email.cc).toContain('c@example.com');
    expect(email.text.trim()).toBe('你好');
  });

  it('decodes legacy GBK body bytes', async () => {
    const email = await decodeEml(
      bytes('Subject: GBK\nContent-Type: text/plain; charset=gbk\nContent-Transfer-Encoding: base64\n\n1tDOxA==')
    );
    expect(email.text.trim()).toBe('中文');
  });

  it('preserves alternative bodies, CID metadata and decoded attachment bytes/names', async () => {
    const email = await decodeEml(
      bytes(`Subject: report
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="outer"

--outer
Content-Type: multipart/alternative; boundary="body"

--body
Content-Type: text/plain; charset=utf-8

plain body
--body
Content-Type: text/html; charset=utf-8

<p>HTML body<img src="cid:photo"></p>
--body--
--outer
Content-Type: image/png
Content-ID: <photo>
Content-Disposition: inline; filename="photo.png"
Content-Transfer-Encoding: base64

iVBORw0KGgo=
--outer
Content-Type: application/octet-stream
Content-Disposition: attachment; filename*=utf-8''%E6%8A%A5%E5%91%8A.txt
Content-Transfer-Encoding: base64

YWJj
--outer--`)
    );
    expect(email.text).toContain('plain body');
    expect(email.html).toContain('cid:photo');
    expect(email.attachments).toHaveLength(2);
    expect(email.attachments[0].contentId).toContain('photo');
    expect(email.attachments[1].name).toBe('报告.txt');
    expect(new Uint8Array(email.attachments[1].buffer)).toEqual(new Uint8Array([97, 98, 99]));
  });

  it('keeps nested messages as attachments instead of recursively merging their body', async () => {
    const email = await decodeEml(
      bytes(
        'Subject: outer\nContent-Type: multipart/mixed; boundary="part"\n\n--part\nContent-Type: text/plain\n\nouter body\n--part\nContent-Type: message/rfc822\nContent-Disposition: attachment; filename="forward.eml"\n\nSubject: inner\n\ninner body\n--part--'
      )
    );
    expect(email.text).toContain('outer body');
    expect(email.text).not.toContain('inner body');
    expect(email.attachments[0].name).toBe('forward.eml');
  });

  it('sanitizes attachment names without modifying content', () => {
    expect(emlAttachmentName('../folder/报告\u202e.txt\u0000')).toBe('报告.txt');
    expect(emlAttachmentName('C:\\folder\\a.pdf')).toBe('a.pdf');
    expect(emlAttachmentName(null)).toBe('');
  });

  it('rejects invalid or encrypted messages', async () => {
    await expect(decodeEml(bytes('not an email'))).rejects.toMatchObject({ code: 'invalid' });
    await expect(
      decodeEml(bytes('Subject: secret\nContent-Type: application/pkcs7-mime; smime-type=enveloped-data\n\nsecret'))
    ).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('bounds input, body, MIME separators and attachment count', async () => {
    await expect(decodeEml(new ArrayBuffer(MAX_BINARY_PREVIEW_BYTES + 1))).rejects.toMatchObject({ code: 'limit' });
    await expect(decodeEml(bytes('Subject: large\n\n' + 'x'.repeat(MAX_EML_BODY_BYTES + 1)))).rejects.toMatchObject({
      code: 'limit',
    });
    await expect(decodeEml(bytes('Subject: wide\n\n' + '--part\n'.repeat(1001)))).rejects.toMatchObject({
      code: 'limit',
    });
    const attachments = Array.from(
      { length: 101 },
      (_, i) =>
        `--part\nContent-Type: application/octet-stream\nContent-Disposition: attachment; filename="${i}.bin"\n\nx\n`
    ).join('');
    await expect(
      decodeEml(bytes(`Subject: many\nContent-Type: multipart/mixed; boundary="part"\n\n${attachments}--part--`))
    ).rejects.toMatchObject({ code: 'limit' });
  });
});
