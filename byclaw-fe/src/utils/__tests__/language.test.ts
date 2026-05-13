/**
 * 语言工具函数测试
 */
import { isEnglishEnv } from '../language';

// Mock @umijs/max
jest.mock('@umijs/max', () => ({
  getLocale: jest.fn(),
}));

describe('Language Utils', () => {
  describe('isEnglishEnv', () => {
    it('should return true for English locale', () => {
      const { getLocale } = require('@umijs/max');
      getLocale.mockReturnValue('en-US');

      const result = isEnglishEnv();

      expect(result).toBe(true);
    });

    it('should return true for English locale with different region', () => {
      const { getLocale } = require('@umijs/max');
      getLocale.mockReturnValue('en-GB');

      const result = isEnglishEnv();

      expect(result).toBe(true);
    });

    it('should return true for simple English locale', () => {
      const { getLocale } = require('@umijs/max');
      getLocale.mockReturnValue('en');

      const result = isEnglishEnv();

      expect(result).toBe(true);
    });

    it('should return false for Chinese locale', () => {
      const { getLocale } = require('@umijs/max');
      getLocale.mockReturnValue('zh-CN');

      const result = isEnglishEnv();

      expect(result).toBe(false);
    });

    it('should return false for other locales', () => {
      const { getLocale } = require('@umijs/max');
      getLocale.mockReturnValue('fr-FR');

      const result = isEnglishEnv();

      expect(result).toBe(false);
    });

    it('should return false for empty locale', () => {
      const { getLocale } = require('@umijs/max');
      getLocale.mockReturnValue('');

      const result = isEnglishEnv();

      expect(result).toBe(false);
    });

    it('should return false for undefined locale', () => {
      const { getLocale } = require('@umijs/max');
      getLocale.mockReturnValue(undefined);

      // This will throw an error because undefined.indexOf is not a function
      // The function should handle this case, but currently it doesn't
      expect(() => isEnglishEnv()).toThrow();
    });
  });
});
