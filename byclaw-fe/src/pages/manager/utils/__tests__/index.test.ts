jest.mock('@umijs/max', () => ({
  getDvaApp: jest.fn(),
}));

import { fixU16Code, getBgImgPosBySize, getDynamicParameters, num2time } from '../index';

describe('manager/utils/index', () => {
  describe('getDynamicParameters', () => {
    it('extracts unique template parameters in order', () => {
      expect(getDynamicParameters('select * from {tenant_code} where id = {user_id} and id = {user_id}')).toEqual([
        '{tenant_code}',
        '{user_id}',
      ]);
    });

    it('returns an empty array when no parameters exist', () => {
      expect(getDynamicParameters('select * from table')).toEqual([]);
    });
  });

  describe('num2time', () => {
    it('formats seconds into mm:ss or h:mm:ss', () => {
      expect(num2time(0)).toBe('00:00');
      expect(num2time(59)).toBe('00:59');
      expect(num2time(61)).toBe('01:01');
      expect(num2time(3661)).toBe('1:01:01');
    });
  });

  describe('getBgImgPosBySize', () => {
    const size = { width: 20, height: 10, startY: 5 };

    it('calculates first-row positions', () => {
      expect(getBgImgPosBySize(0, size)).toBe('0 -5px');
      expect(getBgImgPosBySize(2, size)).toBe('-40px -5px');
    });

    it('calculates wrapped positions when rowCount is provided', () => {
      expect(getBgImgPosBySize(3, size, 3)).toBe('0 -5px');
      expect(getBgImgPosBySize(4, size, 3)).toBe('-20px -5px');
      expect(getBgImgPosBySize(7, size, 3)).toBe('-20px -15px');
    });
  });

  describe('fixU16Code', () => {
    it('returns the original falsy value unchanged', () => {
      expect(fixU16Code('')).toBe('');
    });

    it('converts text using UTF-8 byte char codes', () => {
      expect(fixU16Code('A')).toBe('A');
      expect(fixU16Code('中')).toBe(String.fromCharCode(...new TextEncoder().encode('中')));
    });
  });
});
