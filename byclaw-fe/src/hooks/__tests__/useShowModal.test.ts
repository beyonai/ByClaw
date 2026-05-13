import { renderHook, act } from '@testing-library/react';
import useShowModal, { getTitle } from '../useShowModal';

// Mock intl
jest.mock('@umijs/max', () => ({
  getIntl: () => ({
    formatMessage: jest.fn(({ id }: { id: string }) => {
      const messages: Record<string, string> = {
        'common.add': '添加',
        'common.edit': '编辑',
        'common.view': '查看',
      };
      return messages[id] || id;
    }),
  }),
}));

describe('useShowModal', () => {
  describe('getTitle', () => {
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

    it('should return title without text when text is empty', () => {
      const result = getTitle('add', '');
      expect(result).toBe('添加');
    });

    it('should handle undefined text', () => {
      const result = getTitle('add', undefined as any);
      expect(result).toBe('添加');
    });
  });

  describe('useShowModal hook', () => {
    it('should have correct initial state', () => {
      const { result } = renderHook(() => useShowModal());
      const [state, operations] = result.current;

      expect(state.open).toBe(false);
      expect(state.data).toBeUndefined();
      expect(state.type).toBeUndefined();
      expect(operations.handleShow).toBeInstanceOf(Function);
      expect(operations.onCancel).toBeInstanceOf(Function);
    });

    it('should open modal with add type', () => {
      const { result } = renderHook(() => useShowModal());
      const [, operations] = result.current;

      act(() => {
        operations.handleShow('add');
      });

      const [state] = result.current;
      expect(state.open).toBe(true);
      expect(state.type).toBe('add');
      expect(state.data).toBeUndefined();
    });

    it('should open modal with edit type and data', () => {
      const { result } = renderHook(() => useShowModal<{ id: number; name: string }>());
      const [, operations] = result.current;
      const testData = { id: 1, name: 'Test User' };

      act(() => {
        operations.handleShow('edit', testData);
      });

      const [state] = result.current;
      expect(state.open).toBe(true);
      expect(state.type).toBe('edit');
      expect(state.data).toEqual(testData);
    });

    it('should open modal with view type and data', () => {
      const { result } = renderHook(() => useShowModal<{ id: number; name: string }>());
      const [, operations] = result.current;
      const testData = { id: 1, name: 'Test User' };

      act(() => {
        operations.handleShow('view', testData);
      });

      const [state] = result.current;
      expect(state.open).toBe(true);
      expect(state.type).toBe('view');
      expect(state.data).toEqual(testData);
    });

    it('should close modal and reset state', () => {
      const { result } = renderHook(() => useShowModal<{ id: number; name: string }>());
      const [, operations] = result.current;
      const testData = { id: 1, name: 'Test User' };

      // First open modal
      act(() => {
        operations.handleShow('edit', testData);
      });

      let [state] = result.current;
      expect(state.open).toBe(true);
      expect(state.data).toEqual(testData);

      // Then close modal
      act(() => {
        operations.onCancel();
      });

      [state] = result.current;
      expect(state.open).toBe(false);
      expect(state.data).toBeUndefined();
      expect(state.type).toBeUndefined();
    });

    it('should handle multiple open/close cycles', () => {
      const { result } = renderHook(() => useShowModal<{ id: number; name: string }>());
      const [, operations] = result.current;

      // First cycle
      act(() => {
        operations.handleShow('add');
      });
      expect(result.current[0].open).toBe(true);

      act(() => {
        operations.onCancel();
      });
      expect(result.current[0].open).toBe(false);

      // Second cycle
      act(() => {
        operations.handleShow('edit', { id: 1, name: 'Test' });
      });
      expect(result.current[0].open).toBe(true);
      expect(result.current[0].data).toEqual({ id: 1, name: 'Test' });

      act(() => {
        operations.onCancel();
      });
      expect(result.current[0].open).toBe(false);
    });

    it('should work with different data types', () => {
      const { result } = renderHook(() => useShowModal<string>());
      const [, operations] = result.current;

      act(() => {
        operations.handleShow('view', 'test string');
      });

      const [state] = result.current;
      expect(state.data).toBe('test string');
    });

    it('should work with complex data types', () => {
      interface ComplexData {
        id: number;
        name: string;
        items: string[];
        metadata: {
          created: Date;
          updated: Date;
        };
      }

      const { result } = renderHook(() => useShowModal<ComplexData>());
      const [, operations] = result.current;
      const complexData: ComplexData = {
        id: 1,
        name: 'Test',
        items: ['item1', 'item2'],
        metadata: {
          created: new Date('2024-01-01'),
          updated: new Date('2024-01-02'),
        },
      };

      act(() => {
        operations.handleShow('edit', complexData);
      });

      const [state] = result.current;
      expect(state.data).toEqual(complexData);
    });
  });
});
