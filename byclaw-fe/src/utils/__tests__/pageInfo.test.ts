import { getDefaultPagination, paginationReducer, IPagination } from '../pageInfo';

describe('Page Info Utils', () => {
  describe('getDefaultPagination', () => {
    it('should return default pagination when no initPage provided', () => {
      const result = getDefaultPagination();
      expect(result).toEqual({
        pageCount: 0,
        pageIndex: 1,
        pageSize: 10,
        total: 0,
      });
    });

    it('should merge initPage with defaults', () => {
      const initPage = {
        pageIndex: 2,
        pageSize: 20,
        total: 100,
      };
      const result = getDefaultPagination(initPage);
      expect(result).toEqual({
        pageCount: 0,
        pageIndex: 2,
        pageSize: 20,
        total: 100,
      });
    });

    it('should override all default values', () => {
      const initPage: IPagination = {
        pageCount: 5,
        pageIndex: 3,
        pageSize: 25,
        total: 125,
      };
      const result = getDefaultPagination(initPage);
      expect(result).toEqual({
        pageCount: 5,
        pageIndex: 3,
        pageSize: 25,
        total: 125,
      });
    });

    it('should handle partial initPage', () => {
      const initPage = {
        pageIndex: 5,
      };
      const result = getDefaultPagination(initPage);
      expect(result).toEqual({
        pageCount: 0,
        pageIndex: 5,
        pageSize: 10,
        total: 0,
      });
    });

    it('should handle empty initPage object', () => {
      const result = getDefaultPagination({});
      expect(result).toEqual({
        pageCount: 0,
        pageIndex: 1,
        pageSize: 10,
        total: 0,
      });
    });
  });

  describe('paginationReducer', () => {
    const initialState: IPagination = {
      pageCount: 0,
      pageIndex: 1,
      pageSize: 10,
      total: 0,
    };

    it('should update pagination state with change action', () => {
      const action = {
        type: 'change',
        item: {
          pageIndex: 2,
          pageSize: 20,
        },
      };
      const result = paginationReducer(initialState, action);
      expect(result).toEqual({
        pageCount: 0,
        pageIndex: 2,
        pageSize: 20,
        total: 0,
      });
    });

    it('should update single property', () => {
      const action = {
        type: 'change',
        item: {
          pageIndex: 5,
        },
      };
      const result = paginationReducer(initialState, action);
      expect(result).toEqual({
        pageCount: 0,
        pageIndex: 5,
        pageSize: 10,
        total: 0,
      });
    });

    it('should update all properties', () => {
      const action = {
        type: 'change',
        item: {
          pageCount: 10,
          pageIndex: 3,
          pageSize: 25,
          total: 250,
        },
      };
      const result = paginationReducer(initialState, action);
      expect(result).toEqual({
        pageCount: 10,
        pageIndex: 3,
        pageSize: 25,
        total: 250,
      });
    });

    it('should handle empty item object', () => {
      const action = {
        type: 'change',
        item: {},
      };
      const result = paginationReducer(initialState, action);
      expect(result).toEqual(initialState);
    });

    it('should throw error for unknown action type', () => {
      const action = {
        type: 'unknown',
        item: {
          pageIndex: 2,
        },
      };
      expect(() => paginationReducer(initialState, action)).toThrow();
    });

    it('should preserve original state when no changes', () => {
      const action = {
        type: 'change',
        item: {
          pageIndex: 1,
          pageSize: 10,
        },
      };
      const result = paginationReducer(initialState, action);
      expect(result).toEqual(initialState);
    });

    it('should handle partial updates correctly', () => {
      const stateWithData: IPagination = {
        pageCount: 5,
        pageIndex: 2,
        pageSize: 20,
        total: 100,
      };
      const action = {
        type: 'change',
        item: {
          pageIndex: 3,
        },
      };
      const result = paginationReducer(stateWithData, action);
      expect(result).toEqual({
        pageCount: 5,
        pageIndex: 3,
        pageSize: 20,
        total: 100,
      });
    });
  });
});
