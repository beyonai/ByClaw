import { parse, stringify } from '../qs';

describe('Query String Utils', () => {
  describe('parse', () => {
    it('should parse query string without prefix', () => {
      const result = parse('name=John&age=30');
      expect(result).toEqual({
        name: 'John',
        age: '30',
      });
    });

    it('should parse query string with ? prefix', () => {
      const result = parse('?name=John&age=30');
      expect(result).toEqual({
        name: 'John',
        age: '30',
      });
    });

    it('should parse query string with # prefix', () => {
      const result = parse('#name=John&age=30');
      expect(result).toEqual({
        name: 'John',
        age: '30',
      });
    });

    it('should handle empty string', () => {
      const result = parse('');
      expect(result).toEqual({});
    });

    it('should handle string with only prefix', () => {
      const result = parse('?');
      expect(result).toEqual({});
    });

    it('should handle string with only #', () => {
      const result = parse('#');
      expect(result).toEqual({});
    });

    it('should decode URL encoded values', () => {
      const result = parse('name=John%20Doe&city=New%20York');
      expect(result).toEqual({
        name: 'John Doe',
        city: 'New York',
      });
    });

    it('should handle parameters without values', () => {
      const result = parse('name=John&age=&city=NewYork');
      expect(result).toEqual({
        name: 'John',
        age: '',
        city: 'NewYork',
      });
    });

    it('should handle parameters without equals sign', () => {
      const result = parse('name=John&invalid&age=30');
      expect(result).toEqual({
        name: 'John',
        age: '30',
      });
    });

    it('should handle parameters starting with equals sign', () => {
      const result = parse('name=John&=invalid&age=30');
      expect(result).toEqual({
        name: 'John',
        age: '30',
      });
    });

    it('should handle single parameter', () => {
      const result = parse('name=John');
      expect(result).toEqual({
        name: 'John',
      });
    });

    it('should handle parameters with special characters', () => {
      const result = parse('search=hello%20world&filter=active%3Dtrue');
      expect(result).toEqual({
        search: 'hello world',
        filter: 'active=true',
      });
    });
  });

  describe('stringify', () => {
    it('should stringify object to query string', () => {
      const result = stringify({ name: 'John', age: '30' });
      expect(result).toBe('name=John&age=30');
    });

    it('should handle empty object', () => {
      const result = stringify({});
      expect(result).toBe('');
    });

    it('should handle single property', () => {
      const result = stringify({ name: 'John' });
      expect(result).toBe('name=John');
    });

    it('should handle properties with empty values', () => {
      const result = stringify({ name: 'John', age: '', city: 'NewYork' });
      expect(result).toBe('name=John&age=&city=NewYork');
    });

    it('should handle properties with special characters', () => {
      const result = stringify({ search: 'hello world', filter: 'active=true' });
      expect(result).toBe('search=hello world&filter=active=true');
    });

    it('should handle numeric values', () => {
      const result = stringify({ count: 5, price: 10.99 });
      expect(result).toBe('count=5&price=10.99');
    });

    it('should handle boolean values', () => {
      const result = stringify({ active: true, visible: false });
      expect(result).toBe('active=true&visible=false');
    });

    it('should handle null and undefined values', () => {
      const result = stringify({ name: 'John', age: null, city: undefined });
      expect(result).toBe('name=John&age=null&city=undefined');
    });
  });

  describe('parse and stringify round trip', () => {
    it('should maintain consistency for simple objects', () => {
      const original = { name: 'John', age: '30' };
      const stringified = stringify(original);
      const parsed = parse(stringified);
      expect(parsed).toEqual(original);
    });

    it('should maintain consistency for objects with special characters', () => {
      const original = { search: 'hello world', filter: 'active=true' };
      const stringified = stringify(original);
      const parsed = parse(stringified);
      expect(parsed).toEqual(original);
    });
  });
});
