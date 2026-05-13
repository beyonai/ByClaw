/* eslint-disable lines-around-comment */

/** 查询来源类型，必填 */
export type QuerySourceMode = 'searchQuery' | 'functionCloud';

/** 来源树根节点ID */
export type SourceRootId = 'userImported' | 'knowledgeBases' | 'enterpriseKnowledgeBases' | 'skills' | 'favorites';

/**
 * QuerySources 组件类型定义
 */

export type SourceTreeNodeType =
  | 'folder'
  | 'file'
  | 'webSearch'
  | 'knowledgeBase'
  | 'enterpriseKnowledgeBase'
  | 'skill'
  | 'favorite'
  | 'more';

export type SourceTreeNodeId = `${SourceTreeNodeType}-${string}`;

/** 知识来源基础类型 */
export interface KnowledgeSource {
  id: SourceTreeNodeId;
  title: string;
  type: SourceTreeNodeType;
  resourceId?: string;
  datasetId?: string;
  [key: string]: any;
}

export interface SourceBucket {
  // 树组件展开后展示的items
  items: KnowledgeSource[];
  // 该类型的数据总数
  totalCount: number;

  totalItems: KnowledgeSource[];
}

export type ISource = {
  [key in SourceRootId]: SourceBucket;
};

/** 树节点类型 */
export interface SourceTreeNode {
  rootId: SourceRootId;
  id: SourceRootId | SourceTreeNodeId;
  title: string;
  icon?: React.ReactNode;
  type: SourceTreeNodeType;
  children?: SourceTreeNode[];
  totalChildren?: SourceTreeNode[];
  loading?: boolean;
  expandable?: boolean;
  checkable?: boolean;
  sourceData?: KnowledgeSource;
  addable?: boolean;
  onAdd?: () => void;

  /** 对于不可展开节点，显示的总数量 */
  totalCount?: number;

  /** 点击数量文案时的回调（通常用于打开弹窗） */
  onSummaryClick?: (rootId: SourceRootId) => void;
}

/** 搜索状态 */
export type SearchStatus = 'idle' | 'searching' | 'completed';

/** QuerySources组件Props */
export interface QuerySourcesProps {
  /** 自定义类名 */
  className?: string;
  /** 自定义样式 */
  style?: React.CSSProperties;
}

/** 搜索信息 */
export interface SearchInfo {
  query: string;
  mode: SearchMode;
}

/** web search 搜索结果 */
export interface WebSearchResult {
  id: string;
  title: string,
  summary: string,
  url: string,
  favicon: string,
  source: string,
  type: string,
  checked: boolean,
}

/** web search 导入后结果 */
export interface WebSearchResource {
  docArchiveId: string;
  id: string;
  title: string;
  type: SourceRootId;
  fileId: string;
  fileUrl: string;
  sourceUrl: string;
}

export type SearchMode = 'webSearch' | 'knowledgeBase' | 'enterpriseKnowledgeBase';

/** Web搜索区域组件Props */
export interface WebSearchProps {
  /** 是否正在导入 */
  isImporting: boolean;
  /** 搜索状态 */
  status: SearchStatus;
  /** 搜索结果 */
  results: WebSearchResult[];
  /** 搜索回调 */
  onSearch: (query: string, mode: SearchMode) => void;
  /** 删除搜索结果回调 */
  onDeleteResult: () => void;
  /** 导入搜索结果回调 */
  onImportResults: (results: WebSearchResult[]) => Promise<any>;
  /** 查看详情回调 */
  onViewDetail: () => void;
  /** 是否在弹窗中 */
  inModal?: boolean;
  /** 关闭弹窗回调 */
  onCloseModal?: () => void;
  /** 是否禁用 */
  disabled?: boolean;
}

/** 添加来源弹窗组件Props */
export interface AddSourceModalProps {
  /** 是否可见 */
  visible: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 文件上传回调，返回上传结果 */
  onFileUpload?: (file: File) => Promise<{ success: boolean; fileId?: string; fileUrl?: string }>;
  /** 粘贴网址回调 */
  onPasteUrl?: (url: string) => void;
  /** 粘贴文字回调 */
  onPasteText?: (text: string) => Promise<{ success: boolean; fileId?: string; fileUrl?: string }>;
}

/** 正在加载的来源项 */
export interface LoadingSourceItem {
  id: SourceTreeNodeId;
  title: string;
  type: SourceTreeNodeType;
  loading: boolean;
}

/** 搜索结果卡片Props */
export interface SearchResultCardProps {
  /** 是否正在导入 */
  isImporting: boolean;
  /** 搜索结果列表 */
  results: WebSearchResult[];
  /** 删除回调 */
  onDelete: () => void;
  /** 导入回调 */
  onImport: (results: WebSearchResult[]) => Promise<any>;
  /** 查看详情回调 */
  onViewDetail: () => void;
  /** 最大展示数量 */
  maxDisplayCount?: number;
}

/** 来源树组件Props */
export interface SourceTreeProps {
  /** 树节点数据 */
  treeData: SourceTreeNode[];
  /** 已勾选的ID列表 */
  checkedIds: SourceTreeNodeId[];
  /** 勾选变化回调 */
  onCheckChange: (sourceTreeNode: SourceTreeNode | SourceTreeNode[], checked: boolean, rootId: SourceRootId) => void;
  /** 点击文件类型节点回调 */
  onFileNodeClick?: (node: SourceTreeNode) => void;
  /** 重命名节点回调（仅文件等非文件夹节点） */
  onRenameNode?: (node: SourceTreeNode) => void;
  /** 删除节点回调（仅文件等非文件夹节点） */
  onDeleteNode?: (node: SourceTreeNode) => void;
}

export interface DingTalkSource {
  id: string;
  title: string;
  type: string;
  checked: boolean,
  summary: string;
}

export type FavoriteSource = {
  id: string;
  title: string;
  type: string;
  checked: boolean;
  summary: string;
}

export type KnowledgeBaseSource = {
  id: string;
  title: string;
  type: string;
  checked: boolean;
  summary: string;
}