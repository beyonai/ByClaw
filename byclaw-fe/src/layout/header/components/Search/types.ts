import type { ResourceItem } from '@/layout/sider/components/ResourceSiderPanel/ResourceSiderListItem';

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

export interface EmployeeResourceDrillBreadcrumb {
  item: ResourceItem;
  list: ResourceItem[];
}

export interface EmployeeResourceDrillState {
  tabKey: string;
  breadcrumb: EmployeeResourceDrillBreadcrumb[];
  list: ResourceItem[];
}
