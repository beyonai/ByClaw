export type IPagination = {
  pageCount: number;
  pageIndex: number;
  pageSize: number;
  total: number;
};

export const getDefaultPagination = (initPage: Partial<IPagination> = {}) => ({
  pageCount: 0,
  pageIndex: 1,
  pageSize: 10,
  total: 0,
  ...initPage,
});

export function paginationReducer(state: IPagination, action: { type: string; item: Partial<IPagination> }) {
  switch (action.type) {
    case 'change':
      return { ...state, ...action.item };
    default:
      throw new Error();
  }
}
