import { parse, stringify } from '@/utils/qs';

describe('manager/utils/qs', () => {
  describe('parse', () => {
    it('parses a normal query string', () => {
      expect(parse('name=alice&age=18')).toEqual({ name: 'alice', age: '18' });
    });

    it('strips leading question mark or hash', () => {
      expect(parse('?name=alice')).toEqual({ name: 'alice' });
      expect(parse('#name=alice')).toEqual({ name: 'alice' });
    });

    it('decodes URI components', () => {
      expect(parse('keyword=%E4%B8%AD%E6%96%87')).toEqual({ keyword: '中文' });
    });

    it('returns empty object for empty input', () => {
      expect(parse('')).toEqual({});
    });

    it('ignores entries without a valid key/value separator', () => {
      expect(parse('name=alice&invalid&=oops')).toEqual({ name: 'alice' });
    });

    it('keeps everything after the first equal sign as the value', () => {
      expect(parse('redirect=a=b=c')).toEqual({ redirect: 'a=b=c' });
    });
  });

  describe('stringify', () => {
    it('stringifies a plain object', () => {
      expect(stringify({ name: 'alice', age: 18 })).toBe('name=alice&age=18');
    });

    it('returns an empty string for an empty object', () => {
      expect(stringify({})).toBe('');
    });
  });
});
