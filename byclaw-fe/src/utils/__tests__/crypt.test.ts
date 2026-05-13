import Crypt from '../encrypt/sm/gm-crypt/crypt';

describe('utils/encrypt/sm/gm-crypt/crypt', () => {
  it('converts UTF-8 strings to byte arrays and back', () => {
    const input = 'Hello, 世界';
    const encoded = Crypt.stringToArrayBufferInUtf8(input);

    expect(ArrayBuffer.isView(encoded)).toBe(true);
    expect(Array.from(encoded)).toEqual(Array.from(new TextEncoder().encode(input)));
    expect(Crypt.utf8ArrayBufferToString(encoded)).toBe(input);
  });

  it('converts byte arrays to base64 and back', () => {
    const bytes = Uint8Array.from([72, 101, 108, 108, 111]);
    const base64 = Crypt.arrayBufferToBase64(bytes);

    expect(base64).toBe('SGVsbG8=');
    expect(Array.from(Crypt.base64ToArrayBuffer(base64))).toEqual([72, 101, 108, 108, 111]);
  });
});
