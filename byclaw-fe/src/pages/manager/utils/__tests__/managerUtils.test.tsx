import React from 'react';

jest.mock('antd', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('@/pages/manager/components/Ellipsis', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('@/pages/manager/utils/auth', () => ({
  getToken: jest.fn(() => 'token'),
  getssoToken: jest.fn(() => 'sso-token'),
}));

import { arrayToTree, getFilterParams, getRunner, getValidValue } from '../managerUtils';

describe('manager/utils/managerUtils', () => {
  describe('getFilterParams', () => {
    it('maps array keys with the default value formatter', () => {
      expect(getFilterParams(['deptIds', 'status'], { deptIds: [1, 2], status: ['enabled'] })).toEqual({
        deptIds: '1,2',
        status: 'enabled',
      });
    });

    it('maps key aliases with a custom formatter function', () => {
      expect(
        getFilterParams(
          { deptIds: 'departmentIds', status: 'state' },
          { deptIds: [1, 2], status: ['enabled'], empty: [] },
          (value: number[]) => value.join('|')
        )
      ).toEqual({
        departmentIds: '1|2',
        state: 'enabled',
      });
    });

    it('supports formatter maps per field', () => {
      expect(
        getFilterParams(
          { deptIds: 'departmentIds', status: 'state' },
          { deptIds: [1, 2], status: ['enabled'] },
          {
            deptIds: (value: number[]) => value.length,
            defaultValueFormatter: (value: string[]) => value.join('|'),
          }
        )
      ).toEqual({
        departmentIds: 2,
        state: 'enabled',
      });
    });
  });

  describe('getValidValue', () => {
    it('returns empty string for invalid sentinel values', () => {
      expect(getValidValue(null)).toBe('');
      expect(getValidValue(undefined)).toBe('');
      expect(getValidValue('null')).toBe('');
      expect(getValidValue('undefined')).toBe('');
      expect(getValidValue('')).toBe('');
    });

    it('returns the original value for valid inputs', () => {
      expect(getValidValue('0')).toBe('0');
      expect(getValidValue('value')).toBe('value');
    });
  });

  describe('arrayToTree', () => {
    it('builds a tree with custom keys and sorting', () => {
      const result = arrayToTree(
        [
          { id: 2, name: 'child-b', parentId: 1, order: 2 },
          { id: 1, name: 'root', parentId: -1, order: 1 },
          { id: 3, name: 'child-a', parentId: 1, order: 1 },
        ],
        {
          key: 'id',
          label: 'name',
          parentKey: 'parentId',
          childrenKey: 'nodes',
          sortKey: 'order',
        }
      );

      expect(result).toEqual([
        {
          id: 1,
          name: 'root',
          parentId: -1,
          order: 1,
          nodes: [
            { id: 3, name: 'child-a', parentId: 1, order: 1, nodes: [] },
            { id: 2, name: 'child-b', parentId: 1, order: 2, nodes: [] },
          ],
        },
      ]);
    });

    it('returns an empty array for non-array input', () => {
      expect(arrayToTree(null as any)).toEqual([]);
    });

    it('treats self-parented and cyclic nodes as roots', () => {
      const result = arrayToTree(
        [
          { orgId: 1, orgName: 'self', parentOrgId: 1 },
          { orgId: 2, orgName: 'cycle-a', parentOrgId: 3 },
          { orgId: 3, orgName: 'cycle-b', parentOrgId: 2 },
        ],
        {}
      );

      expect(result.map((item) => item.orgId)).toEqual([1, 2, 3]);
    });

    it('treats items with missing parents as roots', () => {
      const result = arrayToTree([{ orgId: 1, orgName: 'orphan', parentOrgId: 999 }], {});
      expect(result).toEqual([{ orgId: 1, orgName: 'orphan', parentOrgId: 999, children: [] }]);
    });
  });

  describe('getRunner', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('runs immediately once the predicate returns true', () => {
      const fn = jest.fn();
      const runner = getRunner(() => true, fn, 10, 2);

      runner.run('x');

      expect(fn).toHaveBeenCalledWith('x');
    });

    it('retries until the predicate becomes true', () => {
      const fn = jest.fn();
      const predicate = jest.fn().mockReturnValueOnce(false).mockReturnValueOnce(false).mockReturnValue(true);
      const runner = getRunner(predicate, fn, 10, 5);

      runner.run('x');
      jest.runAllTimers();

      expect(fn).toHaveBeenCalledWith('x');
      expect(predicate).toHaveBeenCalledTimes(3);
    });

    it('stops retrying after maxCounter or manual stop', () => {
      const fn = jest.fn();
      const runner = getRunner(() => false, fn, 10, 1);

      runner.run('x');
      jest.runAllTimers();
      expect(fn).not.toHaveBeenCalled();

      const fn2 = jest.fn();
      const runner2 = getRunner(() => false, fn2, 10, 5);
      runner2.stop();
      runner2.run('y');
      jest.runAllTimers();

      expect(fn2).not.toHaveBeenCalled();
    });
  });
});
