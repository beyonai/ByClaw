/**
 * 浏览器工具函数测试
 */
import { getHistoryState } from '../browser';

describe('Browser Utils', () => {
  describe('getHistoryState', () => {
    beforeEach(() => {
      // Reset window.history.state before each test
      if (typeof window !== 'undefined') {
        Object.defineProperty(window, 'history', {
          value: {
            state: null,
          },
          writable: true,
        });
      }
    });

    it('should return default value when window is undefined', () => {
      const originalWindow = global.window;
      // @ts-ignore
      delete global.window;

      const result = getHistoryState('testKey', 'defaultValue');
      expect(result).toBe('defaultValue');

      global.window = originalWindow;
    });

    it('should return default value when history state is null', () => {
      if (typeof window !== 'undefined') {
        window.history.state = null;
      }

      const result = getHistoryState('testKey', 'defaultValue');
      expect(result).toBe('defaultValue');
    });

    it('should return default value when key does not exist in history state', () => {
      if (typeof window !== 'undefined') {
        window.history.state = { otherKey: 'otherValue' };
      }

      const result = getHistoryState('testKey', 'defaultValue');
      expect(result).toBe('defaultValue');
    });

    it('should return value from history state when key exists', () => {
      if (typeof window !== 'undefined') {
        window.history.state = { testKey: 'testValue' };
      }

      const result = getHistoryState('testKey', 'defaultValue');
      expect(result).toBe('testValue');
    });

    it('should work with different data types', () => {
      if (typeof window !== 'undefined') {
        const testData = {
          string: 'test',
          number: 123,
          boolean: true,
          object: { nested: 'value' },
          array: [1, 2, 3],
        };

        window.history.state = testData;

        expect(getHistoryState('string', 'default')).toBe('test');
        expect(getHistoryState('number', 0)).toBe(123);
        expect(getHistoryState('boolean', false)).toBe(true);
        expect(getHistoryState('object', {})).toEqual({ nested: 'value' });
        expect(getHistoryState('array', [])).toEqual([1, 2, 3]);
      } else {
        // In Node environment, should return default values
        expect(getHistoryState('string', 'default')).toBe('default');
        expect(getHistoryState('number', 0)).toBe(0);
        expect(getHistoryState('boolean', false)).toBe(false);
        expect(getHistoryState('object', {})).toEqual({});
        expect(getHistoryState('array', [])).toEqual([]);
      }
    });

    it('should return default value when history state is empty object', () => {
      if (typeof window !== 'undefined') {
        window.history.state = {};
      }

      const result = getHistoryState('testKey', 'defaultValue');
      expect(result).toBe('defaultValue');
    });
  });
});
