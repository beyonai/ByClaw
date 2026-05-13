import { cutStrByFullLength, getStrFullLength } from '../index';

describe('manager/components/Ellipsis', () => {
  describe('getStrFullLength', () => {
    it('counts ascii characters as one and full-width characters as two', () => {
      expect(getStrFullLength('abc')).toBe(3);
      expect(getStrFullLength('中文')).toBe(4);
      expect(getStrFullLength('中a文')).toBe(5);
    });

    it('returns zero for empty input', () => {
      expect(getStrFullLength('')).toBe(0);
    });
  });

  describe('cutStrByFullLength', () => {
    it('cuts mixed-width strings by full length', () => {
      expect(cutStrByFullLength('一二，a,', 7)).toBe('一二，a');
      expect(cutStrByFullLength('一22三', 5)).toBe('一22');
    });

    it('returns the original string when the max length is sufficient', () => {
      expect(cutStrByFullLength('hello', 10)).toBe('hello');
    });

    it('returns an empty string when max length is zero', () => {
      expect(cutStrByFullLength('hello', 0)).toBe('');
    });
  });
});
