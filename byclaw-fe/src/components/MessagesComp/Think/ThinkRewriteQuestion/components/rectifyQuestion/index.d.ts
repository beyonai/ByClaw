export type IRecallInfo = {
  complete?: boolean; //是否完全匹配
  list: Array<{
    description?: string;
    mergeName: string;
  }>;
  matchFrom?: number; // 匹配来源： @0 没有完全匹配 * @1 完全匹配知识 * @2 完全匹配同义词
  name: string;
  selectedName?: string;
  type?: string;
};

export type IDataDimInfo = {
  conditionType: string;
  default: boolean;
  formatType: string;
  groupByDate: string;
  name: string;
  type: string;
  value: string;
  selectedDate?: string[];
};
