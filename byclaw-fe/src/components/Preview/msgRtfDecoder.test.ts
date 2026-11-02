/** @jest-environment node */
import { decodeMsgRtf } from './msgRtfDecoder';
import { MAX_EML_BODY_BYTES } from './emlTypes';

// MS-OXRTFCP 4.1 的官方压缩样例，包含字典引用、字面量和结束标记。
const sample = () =>
  new Uint8Array(
    Buffer.from(
      '2d0000002b0000004c5a4675f1c5c7a703000a007263706731323542320af32068656c090020627705b06c647d0a800fa0',
      'hex'
    )
  );
function frame(payload: Uint8Array, size: number, compressed = false) {
  const bytes = new Uint8Array(16 + payload.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.length - 4, true);
  view.setUint32(4, size, true);
  view.setUint32(8, compressed ? 0x75465a4c : 0x414c454d, true);
  let crc = 0;
  if (compressed) {
    for (const byte of payload) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  view.setUint32(12, crc >>> 0, true);
  bytes.set(payload, 16);
  return bytes;
}

describe('bounded MSG compressed RTF', () => {
  it('decodes the protocol sample and preserves the compressed source', () => {
    const source = sample();
    const original = source.slice();
    const result = decodeMsgRtf(source);
    expect(result.byteLength).toBe(43);
    const text = new TextDecoder().decode(result);
    expect(text).toMatch(/^\{\\rtf1/);
    expect(text).toContain('hello');
    expect(text).toContain('world');
    expect(source).toEqual(original);
  });
  it('returns independent bytes for uncompressed MELA bodies', () => {
    const plain = new TextEncoder().encode('{\\rtf1 body}');
    const source = frame(plain, plain.length);
    const decoded = decodeMsgRtf(source);
    expect(new Uint8Array(decoded)).toEqual(plain);
    new Uint8Array(decoded).fill(0);
    expect(source.subarray(16)).toEqual(plain);
  });
  it('supports dictionary wrapping while enforcing the declared raw size', () => {
    const plain = new TextEncoder().encode('{\\rtf1 ' + 'x'.repeat(5000) + '}');
    const payload: number[] = [];
    let index = 0;
    while (index + 8 <= plain.length) {
      payload.push(0, ...plain.subarray(index, index + 8));
      index += 8;
    }
    const rest = plain.length - index;
    const end = ((207 + plain.length) & 4095) << 4;
    payload.push(1 << rest, ...plain.subarray(index), end >>> 8, end & 255);
    const source = frame(new Uint8Array(payload), plain.length, true);
    expect(new Uint8Array(decodeMsgRtf(source))).toEqual(plain);
    new DataView(source.buffer).setUint32(4, plain.length - 1, true);
    expect(() => decodeMsgRtf(source)).toThrow('invalid');
  });
  it('rejects CRC damage, invalid lengths, oversized declarations and unknown algorithms', () => {
    const corrupt = sample();
    corrupt[20] ^= 1;
    expect(() => decodeMsgRtf(corrupt)).toThrow('invalid');
    expect(() => decodeMsgRtf(sample().subarray(1))).toThrow();
    const oversized = sample();
    new DataView(oversized.buffer).setUint32(4, MAX_EML_BODY_BYTES + 1, true);
    expect(() => decodeMsgRtf(oversized)).toThrow('limit');
    const unknown = sample();
    new DataView(unknown.buffer).setUint32(8, 0, true);
    expect(() => decodeMsgRtf(unknown)).toThrow('unsupported');
    expect(() => decodeMsgRtf(frame(new Uint8Array([1]), 2))).toThrow('invalid');
    const mela = frame(new Uint8Array([1]), 1);
    mela[12] = 1;
    expect(() => decodeMsgRtf(mela)).toThrow('invalid');
  });
  it('rejects uninitialized references, missing end markers and premature termination even with valid CRC', () => {
    for (const payload of [
      [1, 0xff, 0xf0],
      [0, 65],
      [1, 0x0c, 0xf0],
      [1, 0],
    ]) {
      expect(() => decodeMsgRtf(frame(new Uint8Array(payload), 1, true))).toThrow('invalid');
    }
  });
});
