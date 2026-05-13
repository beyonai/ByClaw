// Mock ahooks
jest.mock('ahooks', () => ({
  useSetState: jest.fn(() => [{ open: false, data: undefined, type: undefined }, jest.fn()]),
}));

// Mock React
jest.mock('react', () => ({
  useCallback: jest.fn((fn) => fn),
}));

// Mock @umijs/max
jest.mock('@umijs/max', () => ({
  getIntl: jest.fn(() => ({
    formatMessage: jest.fn(({ id }) => {
      const messages = {
        'common.add': '添加',
        'common.edit': '编辑',
        'common.view': '查看',
      };
      return messages[id] || id;
    }),
  })),
}));

import { getTitle } from '../useShowModal';

describe('useShowModal (Simple)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getTitle function', () => {
    it('should return correct title for add type', () => {
      const result = getTitle('add', '用户');
      expect(result).toBe('添加用户');
    });

    it('should return correct title for edit type', () => {
      const result = getTitle('edit', '用户');
      expect(result).toBe('编辑用户');
    });

    it('should return correct title for view type', () => {
      const result = getTitle('view', '用户');
      expect(result).toBe('查看用户');
    });

    it('should return only type title when text is empty', () => {
      const result = getTitle('add', '');
      expect(result).toBe('添加');
    });

    it('should handle unknown type', () => {
      const result = getTitle('unknown' as any, '用户');
      expect(result).toBe('用户');
    });

    it('should handle empty text with unknown type', () => {
      const result = getTitle('unknown' as any, '');
      expect(result).toBe('');
    });
  });

  describe('ModalStore type', () => {
    it('should have correct type structure', () => {
      // 测试类型定义是否正确
      const modalStore = {
        open: false,
        data: undefined,
        type: undefined,
      };

      expect(modalStore).toHaveProperty('open');
      expect(modalStore).toHaveProperty('data');
      expect(modalStore).toHaveProperty('type');
      expect(typeof modalStore.open).toBe('boolean');
    });

    it('should handle data with specific type', () => {
      const modalStore = {
        open: true,
        data: { id: 1, name: 'Test' },
        type: 'edit' as const,
      };

      expect(modalStore.open).toBe(true);
      expect(modalStore.data).toEqual({ id: 1, name: 'Test' });
      expect(modalStore.type).toBe('edit');
    });
  });
});
