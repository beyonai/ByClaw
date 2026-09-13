export interface HeaderSearchPageProps {
  keyword?: string;
  className?: string;
  setShowSearch: (show: boolean) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  showSearch: boolean;
  displayInModal?: boolean;
}

export interface HeaderSearchResult {
  digitList: any[];
  userList: any[];
  sessionList: any[];
}

export interface SearchTabItem {
  key: string;
  title: string;
}

export interface EmployeeResourceTabConfig {
  key: string;
  labelId: string;
  resourceBizTypeList: string[];
}

export interface EmployeeResourceTab extends EmployeeResourceTabConfig {
  title: string;
}

export interface EmployeeResourceGroup {
  key: 'current' | 'personal' | 'enterprise';
  title: string;
  description?: string;
  list: any[];
  quoteDisabled?: boolean;
}

export type KnowledgeResourceGroup = EmployeeResourceGroup;
