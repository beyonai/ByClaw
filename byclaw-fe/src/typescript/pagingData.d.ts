export type PagingData<T> = {
  pageInfo?: {
    pageCount?: number;
    pageIndex?: number;
    pageSize?: number;
    total?: number;
  };
  pageNum: number;
  pageSize: number;
  data: T[];
  rows?: T[];
  total?: number;
};