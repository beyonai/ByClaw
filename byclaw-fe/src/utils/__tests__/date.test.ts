/**
 * 日期工具函数测试
 */
import { formatDate, getFriendlyDate, getTimeGap, getTimeAgo } from '../date';

// Mock dayjs
jest.mock('dayjs', () => {
  const originalDayjs = jest.requireActual('dayjs');
  const mockDayjs = (date?: any) => {
    const instance = originalDayjs(date);
    // Mock specific methods
    instance.format = jest.fn((format: string) => {
      if (format === 'YYYY-MM-DD') return '2023-01-01';
      if (format === 'HH:mm') return '12:00';
      if (format === 'MM-DD HH:mm') return '01-01 12:00';
      if (format === 'YYYY-MM-DD HH:mm') return '2023-01-01 12:00';
      return '2023-01-01 12:00:00';
    });
    instance.hour = jest.fn(() => 12);
    instance.isAfter = jest.fn(() => false);
    instance.diff = jest.fn((target: any, unit: string) => {
      if (unit === 'second') return 30;
      if (unit === 'minute') return 5;
      if (unit === 'hour') return 2;
      if (unit === 'day') return 1;
      return 0;
    });
    return instance;
  };
  return mockDayjs;
});

// Mock @umijs/max
jest.mock('@umijs/max', () => ({
  getIntl: () => ({
    formatMessage: jest.fn(({ id }: { id: string }, values?: any) => {
      const messages: { [key: string]: string } = {
        'date.earlier': '更早',
        'date.today': '今天',
        'date.sevenDays': '7天内',
        'date.daysAgo': `${values?.days}天前`,
        'date.hoursAgo': `${values?.hours}小时前`,
        'date.minutesAgo': `${values?.minutes}分钟前`,
        'date.secondsAgo': `${values?.seconds}秒前`,
      };
      return messages[id] || id;
    }),
  }),
}));

describe('Date Utils', () => {
  describe('formatDate', () => {
    it('should format timestamp to date string', () => {
      const timestamp = 1672531200000; // 2023-01-01 00:00:00 UTC
      const result = formatDate(timestamp);
      // 验证格式是否正确，不依赖具体时区
      expect(result).toMatch(/^\d{4}-\d{1,2}-\d{1,2} \d{1,2}:\d{2}:\d{2}$/);
      // 验证包含年份2023
      expect(result).toContain('2023');
    });

    it('should handle zero timestamp', () => {
      const result = formatDate(0);
      // 验证格式是否正确，不依赖具体时区
      expect(result).toMatch(/^\d{4}-\d{1,2}-\d{1,2} \d{1,2}:\d{2}:\d{2}$/);
      // 验证包含年份1970（Unix epoch）
      expect(result).toContain('1970');
    });

    it('should format date consistently', () => {
      // 使用一个固定的时间戳进行测试
      const timestamp = 1672531200000; // 2023-01-01 00:00:00 UTC
      const result1 = formatDate(timestamp);
      const result2 = formatDate(timestamp);
      // 多次调用应该返回相同结果
      expect(result1).toBe(result2);
    });
  });

  describe('getFriendlyDate', () => {
    it('should return empty string for invalid time', () => {
      expect(getFriendlyDate(0)).toBe('');
      expect(getFriendlyDate(null as any)).toBe('');
      expect(getFriendlyDate(undefined as any)).toBe('');
    });

    it('should return formatted time for valid timestamp', () => {
      const timestamp = 1672531200000;
      const result = getFriendlyDate(timestamp);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('getTimeGap', () => {
    it('should return time gap label', () => {
      const timestamp = Date.now() - 1000 * 60 * 60 * 24; // 1 day ago
      const result = getTimeGap(timestamp);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle current time', () => {
      const timestamp = Date.now();
      const result = getTimeGap(timestamp);
      expect(typeof result).toBe('string');
    });
  });

  describe('getTimeAgo', () => {
    it('should return time ago description', () => {
      const timestamp = Date.now() - 1000 * 60 * 5; // 5 minutes ago
      const result = getTimeAgo(timestamp);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle string input', () => {
      const result = getTimeAgo('2023-01-01');
      expect(typeof result).toBe('string');
    });

    it('should handle Date object input', () => {
      const date = new Date(Date.now() - 1000 * 60 * 5);
      const result = getTimeAgo(date);
      expect(typeof result).toBe('string');
    });
  });
});
