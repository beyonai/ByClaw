import { isDevelopment, isProduction, isValidEmail, isValidPhone, isValidUrl } from '../common';

describe('utils/common', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('detects development and production environments', () => {
    process.env.NODE_ENV = 'development';
    expect(isDevelopment()).toBe(true);
    expect(isProduction()).toBe(false);

    process.env.NODE_ENV = 'production';
    expect(isDevelopment()).toBe(false);
    expect(isProduction()).toBe(true);
  });

  it('validates emails, phones and urls', () => {
    expect(isValidEmail('test@example.com')).toBe(true);
    expect(isValidEmail('bad-email')).toBe(false);

    expect(isValidPhone('13812345678')).toBe(true);
    expect(isValidPhone('123456')).toBe(false);

    expect(isValidUrl('https://example.com')).toBe(true);
    expect(isValidUrl('not-a-url')).toBe(false);
  });
});
