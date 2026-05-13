jest.mock('jsencrypt', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    setPublicKey: jest.fn(),
    encrypt: jest.fn((text: string) => `encrypted:${text}`),
  })),
}));

import { encryptByRSA } from '../encrypt/rsa';

describe('utils/encrypt/rsa', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('encrypts text with provided public key and wraps missing pem header', async () => {
    await expect(encryptByRSA('hello', 'ABCDEF')).resolves.toBe('encrypted:hello');
  });

  it('throws a normalized error when encryption fails', async () => {
    const { default: JSEncrypt } = await import('jsencrypt');
    (JSEncrypt as jest.Mock).mockImplementationOnce(() => ({
      setPublicKey: jest.fn(),
      encrypt: jest.fn(() => false),
    }));
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(encryptByRSA('hello')).rejects.toThrow('RSA加密失败');
    expect(errorSpy).toHaveBeenCalled();
  });
});
