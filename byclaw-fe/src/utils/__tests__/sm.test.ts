jest.mock('../encrypt/sm/gm-crypt/sm4', () => {
  return jest.fn().mockImplementation((config) => ({
    config,
    encrypt: jest.fn((value: string) => `enc:${value}`),
    decrypt: jest.fn((value: string) => `dec:${value}`),
  }));
});

import SM4 from '../encrypt/sm/gm-crypt/sm4';
import { decryptBySM, encryptBySM } from '../encrypt/sm';

const MockedSM4 = SM4 as unknown as jest.Mock;

describe('utils/encrypt/sm', () => {
  beforeEach(() => {
    MockedSM4.mockClear();
  });

  it('encryptBySM creates an SM4 instance with the expected config', () => {
    expect(encryptBySM('hello')).toBe('enc:hello');
    expect(MockedSM4).toHaveBeenCalledWith({
      key: 'w4H@A9Klm!E06O^8',
      mode: 'ecb',
    });
  });

  it('decryptBySM reuses the same SM4 config for decryption', () => {
    expect(decryptBySM('ciphertext')).toBe('dec:ciphertext');
    expect(MockedSM4).toHaveBeenCalledWith({
      key: 'w4H@A9Klm!E06O^8',
      mode: 'ecb',
    });
  });
});
