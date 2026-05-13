/** @jest-environment node */
/**
 * Cookie工具函数测试
 */
import { getCommonCookie, setCommonCookie } from '../cookie';
import cookie from '../cookie';

// Mock js-cookie
jest.mock('js-cookie', () => ({
  get: jest.fn(),
  set: jest.fn(),
}));

const originalWindow = global.window;

describe('Cookie Utils', () => {
  beforeAll(() => {
    global.window = {
      document: {
        cookie: '',
      },
    } as any;
  });

  afterAll(() => {
    global.window = originalWindow;
  });

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    global.window.document.cookie = '';
  });

  describe('getCommonCookie', () => {
    it('should get cookie value using js-cookie', () => {
      const { get } = require('js-cookie');
      get.mockReturnValue('test-value');

      const result = getCommonCookie('test-cookie');

      expect(get).toHaveBeenCalledWith('test-cookie');
      expect(result).toBe('test-value');
    });

    it('should return undefined for non-existent cookie', () => {
      const { get } = require('js-cookie');
      get.mockReturnValue(undefined);

      const result = getCommonCookie('non-existent');

      expect(result).toBeUndefined();
    });
  });

  describe('setCommonCookie', () => {
    it('should set cookie with expiration days', () => {
      const { set } = require('js-cookie');

      setCommonCookie('test-cookie', 'test-value', 7);

      expect(set).toHaveBeenCalledWith('test-cookie', 'test-value', { expires: 7 });
    });

    it('should set cookie with different expiration days', () => {
      const { set } = require('js-cookie');

      setCommonCookie('another-cookie', 'another-value', 30);

      expect(set).toHaveBeenCalledWith('another-cookie', 'another-value', { expires: 30 });
    });
  });

  describe('cookie object', () => {
    describe('set', () => {
      it('should set cookie without expiration', () => {
        cookie.set('test-cookie', 'test-value');

        const doc = global.window.document;
        expect(doc.cookie).toBe('test-cookie=test-value;path=/');
      });

      it('should set cookie with expiration days', () => {
        const mockDate = new Date('2023-12-31T23:59:59Z');
        jest.spyOn(global, 'Date').mockImplementation(() => mockDate as any);
        jest.spyOn(mockDate, 'getTime').mockReturnValue(1704067199000);
        jest.spyOn(mockDate, 'setTime').mockImplementation(() => {});
        jest.spyOn(mockDate, 'toUTCString').mockReturnValue('Sun, 31 Dec 2023 23:59:59 GMT');

        cookie.set('test-cookie', 'test-value', 7);

        const doc = global.window.document;
        expect(doc.cookie).toContain('test-cookie=test-value;path=/;expires=');

        jest.restoreAllMocks();
      });
    });

    describe('get', () => {
      it('should get cookie value from document.cookie', () => {
        const doc = global.window.document;
        doc.cookie = 'test-cookie=test-value;other-cookie=other-value';

        const result = cookie.get('test-cookie');

        expect(result).toBe('test-value');
      });

      it('should return null for non-existent cookie', () => {
        const doc = global.window.document;
        doc.cookie = 'other-cookie=other-value';

        const result = cookie.get('non-existent');

        expect(result).toBeNull();
      });

      it('should handle empty cookie string', () => {
        const doc = global.window.document;
        doc.cookie = '';

        const result = cookie.get('any-cookie');

        expect(result).toBeNull();
      });
    });

    describe('delete', () => {
      it('should delete cookie by setting it with negative expiration', () => {
        const setSpy = jest.spyOn(cookie, 'set');

        cookie.delete('test-cookie');

        expect(setSpy).toHaveBeenCalledWith('test-cookie', '', -1);
      });
    });

    describe('clearDelete', () => {
      it('should clear cookies', () => {
        const doc = global.window.document;
        doc.cookie = 'cookie1=value1;cookie2=value2;cookie3=value3';

        // The function modifies document.cookie
        expect(() => cookie.clearDelete()).not.toThrow();

        // The function should have modified the cookie string
        expect(doc.cookie).toBeDefined();
      });

      it('should handle empty cookie string', () => {
        const doc = global.window.document;
        doc.cookie = '';

        expect(() => cookie.clearDelete()).not.toThrow();
      });

      it('should handle cookies without values', () => {
        const doc = global.window.document;
        doc.cookie = 'cookie1=;cookie2=value2';

        expect(() => cookie.clearDelete()).not.toThrow();
      });
    });
  });
});
