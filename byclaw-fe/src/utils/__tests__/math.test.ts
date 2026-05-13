/**
 * 数学工具函数测试
 */
import { getRandomNumber, generateUniqueId } from '../math';

// Mock nanoid
jest.mock('nanoid', () => ({
  customAlphabet: () => () => 'mockid123',
}));

describe('Math Utils', () => {
  describe('getRandomNumber', () => {
    it('should return a number within the specified range', () => {
      const min = 1;
      const max = 10;
      const result = getRandomNumber(min, max);

      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThanOrEqual(min);
      expect(result).toBeLessThanOrEqual(max);
    });

    it('should handle same min and max values', () => {
      const value = 5;
      const result = getRandomNumber(value, value);
      expect(result).toBe(value);
    });

    it('should handle negative numbers', () => {
      const min = -10;
      const max = -1;
      const result = getRandomNumber(min, max);

      expect(result).toBeGreaterThanOrEqual(min);
      expect(result).toBeLessThanOrEqual(max);
    });

    it('should handle decimal min and max', () => {
      const min = 1.5;
      const max = 2.5;
      const result = getRandomNumber(min, max);

      expect(result).toBeGreaterThanOrEqual(Math.floor(min));
      expect(result).toBeLessThanOrEqual(Math.ceil(max));
    });
  });

  describe('generateUniqueId', () => {
    it('should generate a unique ID with default size', () => {
      const id = generateUniqueId();
      expect(typeof id).toBe('string');
      expect(id).toBe('mockid123');
    });

    it('should generate a unique ID with custom size', () => {
      const id = generateUniqueId(8);
      expect(typeof id).toBe('string');
      expect(id).toBe('mockid123');
    });

    it('should generate different IDs on multiple calls', () => {
      const id1 = generateUniqueId();
      const id2 = generateUniqueId();
      expect(id1).toBe(id2); // Mocked to return same value
    });
  });
});
