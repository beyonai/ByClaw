export type IFieldItem = {
  keyword: string;
  recall: string[];
  choiceKeyword?: string;
};

export type IConditionItem = {
  field: string;
  fieldRecall?: string[];
  valueRecall?: string[];
  comparison: keyof ComparisonMap;
  value: string;
  choiceField?: string;
  choiceValue?: string;
  choiceComparison?: string;
};

export type IParadigmResultItem = IFieldItem | IConditionItem;

export type IParadigmItem = {
  paradigmId: string;
  paradigmName: string;
  paradigmResult: IParadigmResultItem[];
};

export enum ComparisonMap {
  eq = '=',
  gt = '>',
  lt = '<',
  gte = '>=',
  lte = '<=',
  between = 'between',
}
