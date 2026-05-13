export interface knowledgeBaseListItem {
  algoConfig: string;
  isDefault: boolean;
  knowledgeBaseId: string;
  knowledgeBaseName: string;
  privilegeType: string;
  knowledgeBaseComment: string;
}

export interface indicatorMeasureItem {
  creator?: string;
  knowledgeName: string;
  focus?: 1 | 0; // 是否关注
  updateTime?: number;
  lastUsedTime?: number;
  updater?: string;
  knowledgeId: string;
  knowledgeAttributeList?: Record<string, any>;
  termId?: string;
  visits?: number;
  createBy?: string;
  vertexTypeId?: number; // 1: 指标 2:维度
  createdTime?: number;
  knowledgeBaseId?: string;
  viewId?: string;
  vertexTypeName?: string;
  isRelateCatalog?: number;
  termName?: string;
}

export interface SuggestionItem {
  createBy: string;
  searchSuggestionsId: string;
  creator: string;
  searchSuggestionsContent: string;
  searchSuggestionsType: string;
  createdTime: number;
  language: string;
  updateTime: number;
  searchSuggestionsTemplate: string;
  searchSuggestionsExample: string;
  updater: string;
}

export interface focusIndicatorItem {
  businessDataType: string;
  creator: string;
  focusIndicatorId: string;
  knowledgeName: string;
  focus: number;
  updateTime: number;
  lastUsedTime: number;
  updater: string;
  knowledgeId: string;
  visits: number;
  indicatorType: string;
  focusTime: number;
  knowledgeBaseId: string;
}
