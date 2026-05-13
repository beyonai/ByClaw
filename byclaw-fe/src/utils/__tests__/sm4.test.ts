import SM4 from '../encrypt/sm/gm-crypt/sm4';

describe('utils/encrypt/sm/gm-crypt/sm4', () => {
  it('encrypts and decrypts text in ECB mode with base64 output', () => {
    const sm4 = new SM4({
      key: 'w4H@A9Klm!E06O^8',
      mode: 'ecb',
    });

    const cipher = sm4.encrypt('hello world');

    expect(typeof cipher).toBe('string');
    expect(cipher).not.toBe('hello world');
    expect(sm4.decrypt(cipher)).toBe('hello world');
  });

  it('encrypts and decrypts text in CBC mode when iv is provided', () => {
    const sm4 = new SM4({
      key: 'w4H@A9Klm!E06O^8',
      iv: '1234567890abcdef',
      mode: 'cbc',
    });

    const cipher = sm4.encrypt('message from cbc');

    expect(sm4.decrypt(cipher)).toBe('message from cbc');
  });

  it('throws when key length is invalid', () => {
    expect(
      () =>
        new SM4({
          key: 'short-key',
          mode: 'ecb',
        })
    ).toThrow('key should be a 16 bytes string');
  });

  it('throws when cbc mode is used without a 16-byte iv', () => {
    const sm4 = new SM4({
      key: 'w4H@A9Klm!E06O^8',
      mode: 'cbc',
    });

    expect(() => sm4.encrypt('hello')).toThrow('iv error');
  });
});
