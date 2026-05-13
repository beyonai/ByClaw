export interface IDatabaseItem {
  knowledgeBaseId: string;
  knowledgeBaseName: string;
  knowledgeBaseComment: string;
}

// 知识库文档类型定义
export interface BIFieldItem {
  knowledgeId: string;
  knowledgeName: string;
}

export enum NodeType {
  dimension = 'dimension',
  measure = 'measure',
  calculation = 'calculation',
}

export interface ITreeItem extends BIFieldItem {
  key: string;
  title: string;
  iconType?: string;
  type: NodeType;
  isLeaf?: boolean;
  children?: ITreeItem[];
}
