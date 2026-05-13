jest.mock('crypto-js', () => ({
  enc: {
    Utf8: {
      parse: jest.fn((value: string) => `parsed:${value}`),
    },
  },
  AES: {
    encrypt: jest.fn(() => ({
      ciphertext: {
        toString: jest.fn(() => 'ciphertext'),
      },
    })),
  },
  mode: {
    CBC: 'CBC',
  },
  pad: {
    Pkcs7: 'Pkcs7',
  },
}));

import { encryptByAES } from '../encrypt/aes';

describe('utils/encrypt/aes', () => {
  it('encrypts text and encodes ciphertext with btoa', () => {
    jest.spyOn(window, 'btoa').mockReturnValue('encoded');

    expect(encryptByAES('hello')).toBe('encoded');
    expect(window.btoa).toHaveBeenCalledWith('ciphertext');
  });
});
