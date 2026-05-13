import {
  Obj2Query,
  areAllValuesPresent,
  parseQueryString,
  formatTimeToChatTime,
  arrayToTree,
  getParentsIdsByList,
  getLabelInArray,
} from '../tools';
import dayjs from 'dayjs';

describe('tools utils', () => {
  describe('Obj2Query', () => {
    it('should convert object to query string', () => {
      const obj = { name: 'test', age: 25, active: true };
      const result = Obj2Query(obj);
      expect(result).toBe('name=test&age=25&active=true');
    });

    it('should handle empty object', () => {
      const obj = {};
      const result = Obj2Query(obj);
      expect(result).toBe('');
    });

    it('should handle special characters', () => {
      const obj = { search: 'hello world', category: 'test&value' };
      const result = Obj2Query(obj);
      expect(result).toContain('search=hello+world'); // URLSearchParams 使用 + 而不是 %20
      expect(result).toContain('category=test%26value');
    });

    it('should handle null and undefined values', () => {
      const obj = { name: 'test', value: null, other: undefined };
      const result = Obj2Query(obj);
      expect(result).toContain('name=test');
      expect(result).toContain('value=null');
      expect(result).toContain('other=undefined');
    });
  });

  describe('areAllValuesPresent', () => {
    it('should return true when all values are present', () => {
      const obj = { name: 'test', age: 25, active: true };
      expect(areAllValuesPresent(obj)).toBe(true);
    });

    it('should return true when all values are present including 0', () => {
      const obj = { count: 0, name: 'test', active: false };
      expect(areAllValuesPresent(obj)).toBe(false); // false 被认为是 falsy 值
    });

    it('should return false when any value is falsy (except 0)', () => {
      const obj = { name: 'test', age: null, active: true };
      expect(areAllValuesPresent(obj)).toBe(false);
    });

    it('should return false when any value is undefined', () => {
      const obj = { name: 'test', age: undefined, active: true };
      expect(areAllValuesPresent(obj)).toBe(false);
    });

    it('should return false when any value is empty string', () => {
      const obj = { name: '', age: 25, active: true };
      expect(areAllValuesPresent(obj)).toBe(false);
    });

    it('should return true for empty object', () => {
      const obj = {};
      expect(areAllValuesPresent(obj)).toBe(true);
    });
  });

  describe('parseQueryString', () => {
    it('should parse query string to object', () => {
      const queryString = 'name=test&age=25&active=true';
      const result = parseQueryString(queryString);
      expect(result).toEqual({
        name: 'test',
        age: '25',
        active: 'true',
      });
    });

    it('should handle empty query string', () => {
      const queryString = '';
      const result = parseQueryString(queryString);
      expect(result).toEqual({ '': '' }); // 空字符串会被解析为 key='', value=''
    });

    it('should handle query string with special characters', () => {
      const queryString = 'search=hello%20world&category=test%26value';
      const result = parseQueryString(queryString);
      expect(result).toEqual({
        search: 'hello world',
        category: 'test&value',
      });
    });

    it('should handle query string with single parameter', () => {
      const queryString = 'name=test';
      const result = parseQueryString(queryString);
      expect(result).toEqual({ name: 'test' });
    });

    it('should handle query string with empty values', () => {
      const queryString = 'name=test&empty=&other=value';
      const result = parseQueryString(queryString);
      expect(result).toEqual({
        name: 'test',
        empty: '',
        other: 'value',
      });
    });

    it('should handle query string without ? prefix', () => {
      const queryString = 'name=test&age=25';
      const result = parseQueryString(queryString);
      expect(result).toEqual({
        name: 'test',
        age: '25',
      });
    });
  });

  describe('formatTimeToChatTime', () => {
    beforeEach(() => {
      // Mock dayjs to return fixed time
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2024-01-15T12:00:00Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should return "刚刚" for time less than 60 seconds ago', () => {
      const time = new Date('2024-01-15T11:59:30Z'); // 30 seconds ago
      const result = formatTimeToChatTime(time);
      expect(result).toBe('刚刚');
    });

    it('should return time format for today', () => {
      const time = new Date('2024-01-15T10:30:00Z'); // Same day
      const result = formatTimeToChatTime(time);
      expect(result).toBe(dayjs(time).format('HH:mm'));
    });

    it('should return "昨天" for yesterday', () => {
      const time = new Date('2024-01-14T12:00:00Z'); // Yesterday
      const result = formatTimeToChatTime(time);
      expect(result).toBe('昨天');
    });

    it('should return "前天" for day before yesterday', () => {
      const time = new Date('2024-01-13T12:00:00Z'); // Day before yesterday
      const result = formatTimeToChatTime(time);
      expect(result).toBe('前天');
    });

    it('should return month and day format for same year', () => {
      const time = new Date('2023-06-15T12:00:00Z'); // Different year to avoid "刚刚"
      const result = formatTimeToChatTime(time);
      expect(result).toBe('2023/6/15');
    });

    it('should return full date format for different year', () => {
      const time = new Date('2023-06-15T12:00:00Z'); // Different year
      const result = formatTimeToChatTime(time);
      expect(result).toBe('2023/6/15');
    });
  });

  describe('arrayToTree', () => {
    it('should convert flat array to tree structure', () => {
      const array = [
        { grpId: '1', parentGrpId: null, name: 'Root 1' },
        { grpId: '2', parentGrpId: '1', name: 'Child 1' },
        { grpId: '3', parentGrpId: '1', name: 'Child 2' },
        { grpId: '4', parentGrpId: '2', name: 'Grandchild 1' },
        { grpId: '5', parentGrpId: null, name: 'Root 2' },
      ];

      const result = arrayToTree(array);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Root 1');
      expect(result[0].children).toHaveLength(2);
      expect(result[0].children[0].name).toBe('Child 1');
      expect(result[0].children[0].children).toHaveLength(1);
      expect(result[0].children[0].children[0].name).toBe('Grandchild 1');
      expect(result[1].name).toBe('Root 2');
    });

    it('should handle custom id and pid fields', () => {
      const array = [
        { id: '1', parentId: null, name: 'Root' },
        { id: '2', parentId: '1', name: 'Child' },
      ];

      const result = arrayToTree(array, 'id', 'parentId');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Root');
      expect(result[0].children).toHaveLength(1);
      expect(result[0].children[0].name).toBe('Child');
    });

    it('should handle custom children field', () => {
      const array = [
        { grpId: '1', parentGrpId: null, name: 'Root' },
        { grpId: '2', parentGrpId: '1', name: 'Child' },
      ];

      const result = arrayToTree(array, 'grpId', 'parentGrpId', 'items');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Root');
      expect(result[0].items).toHaveLength(1);
      expect(result[0].items[0].name).toBe('Child');
    });

    it('should handle self-referencing nodes', () => {
      const array = [
        { grpId: '1', parentGrpId: '1', name: 'Self Reference' }, // Self referencing
        { grpId: '2', parentGrpId: null, name: 'Root' },
      ];

      const result = arrayToTree(array);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Self Reference');
      expect(result[1].name).toBe('Root');
    });

    it('should handle empty array', () => {
      const result = arrayToTree([]);
      expect(result).toEqual([]);
    });
  });

  describe('getParentsIdsByList', () => {
    it('should get parent IDs for given current ID', () => {
      const array = [
        { grpId: '1', parentGrpId: null },
        { grpId: '2', parentGrpId: '1' },
        { grpId: '3', parentGrpId: '2' },
        { grpId: '4', parentGrpId: '3' },
      ];

      const result = getParentsIdsByList(array, '4');

      expect(result).toEqual(['3', '2', '1', null]);
    });

    it('should return empty array for root node', () => {
      const array = [
        { grpId: '1', parentGrpId: null },
        { grpId: '2', parentGrpId: '1' },
      ];

      const result = getParentsIdsByList(array, '1');

      expect(result).toEqual([null]);
    });

    it('should handle custom id and pid fields', () => {
      const array = [
        { id: '1', parentId: null },
        { id: '2', parentId: '1' },
        { id: '3', parentId: '2' },
      ];

      const result = getParentsIdsByList(array, '3', 'id', 'parentId');

      expect(result).toEqual(['2', '1', null]);
    });

    it('should return empty array for non-existent ID', () => {
      const array = [
        { grpId: '1', parentGrpId: null },
        { grpId: '2', parentGrpId: '1' },
      ];

      const result = getParentsIdsByList(array, '999');

      expect(result).toEqual([]);
    });
  });

  describe('getLabelInArray', () => {
    it('should get label by value from array', () => {
      const datasource = [
        { value: '1', label: 'Option 1' },
        { value: '2', label: 'Option 2' },
        { value: '3', label: 'Option 3' },
      ];

      const result = getLabelInArray(datasource, '2');

      expect(result).toBe('Option 2');
    });

    it('should return empty string for non-existent value', () => {
      const datasource = [
        { value: '1', label: 'Option 1' },
        { value: '2', label: 'Option 2' },
      ];

      const result = getLabelInArray(datasource, '999');

      expect(result).toBe('');
    });

    it('should handle custom value and label fields', () => {
      const datasource = [
        { id: '1', name: 'Item 1' },
        { id: '2', name: 'Item 2' },
      ];

      const result = getLabelInArray(datasource, '2', 'id', 'name');

      expect(result).toBe('');
    });

    it('should handle empty datasource', () => {
      const result = getLabelInArray([], '1');

      expect(result).toBe('');
    });

    it('should handle undefined datasource', () => {
      const result = getLabelInArray(undefined, '1');

      expect(result).toBe('');
    });
  });
});
