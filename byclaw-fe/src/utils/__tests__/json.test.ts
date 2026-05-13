import { isJSON } from '../json';

describe('utils/json', () => {
  it('returns true for valid object and array json strings', () => {
    expect(isJSON('{"a":1}')).toBe(true);
    expect(isJSON('[1,2,3]')).toBe(true);
  });

  it('returns false for primitive json values', () => {
    expect(isJSON('"text"')).toBe(false);
    expect(isJSON('1')).toBe(false);
    expect(isJSON('true')).toBe(false);
  });

  it('returns false for invalid input', () => {
    expect(isJSON('{invalid')).toBe(false);
    expect(isJSON(null as any)).toBe(false);
  });
});
