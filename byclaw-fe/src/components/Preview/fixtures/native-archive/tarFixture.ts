/** 最小 ustar 测试包：真实头校验和、块填充和尾部终止块。 */
export function tarFixture(files: { name: string; text?: string; kind?: string; link?: string }[]) {
  const parts: Uint8Array[] = [];
  for (const file of files) {
    const data = new TextEncoder().encode(file.text || '');
    const header = new Uint8Array(512);
    const put = (offset: number, value: string) => header.set(new TextEncoder().encode(value), offset);
    put(0, file.name);
    put(100, '0000644\0');
    put(108, '0000000\0');
    put(116, '0000000\0');
    put(124, data.length.toString(8).padStart(11, '0') + '\0');
    put(136, '00000000000\0');
    header.fill(32, 148, 156);
    put(156, file.kind || '0');
    put(157, file.link || '');
    put(257, 'ustar\0');
    put(263, '00');
    const checksum = header.reduce((total, byte) => total + byte, 0);
    put(148, checksum.toString(8).padStart(6, '0') + '\0 ');
    const padded = new Uint8Array(Math.ceil(data.length / 512) * 512);
    padded.set(data);
    parts.push(header, padded);
  }
  parts.push(new Uint8Array(1024));
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  parts.forEach((part) => {
    result.set(part, offset);
    offset += part.length;
  });
  return result.buffer;
}
