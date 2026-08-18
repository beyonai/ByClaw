import { createContext } from 'react';
import { noop } from 'lodash';

export const DEFAULT_SIDER_CONTENT_WIDTH = 264;
export const SIDER_BAR_WIDTH = 56;
export const HALF_MAIN_CONTENT_DETAIL_PANEL_WIDTH = 'half-main-content';

export interface DetailPanelOptions {
  width?: number | string;
  // 右侧详情面板支持覆盖主会话区域，项目空间渠道配置需要用到。
  overlay?: boolean;
  // 会话资源工作区使用稳定键和标题把传统单详情面板转换为可关闭的页签。
  tabKey?: string;
  title?: React.ReactNode;
}

interface SiderContentContextValue {
  siderContentWidth: number;
  setSiderContentWidth: React.Dispatch<React.SetStateAction<number>>;
  setDetailPanel?: (panel: React.ReactNode, options?: DetailPanelOptions) => void;
  clearDetailPanel?: () => void;
}

export const SiderContentContext = createContext<SiderContentContextValue>({
  siderContentWidth: DEFAULT_SIDER_CONTENT_WIDTH,
  setSiderContentWidth: noop,
  setDetailPanel: noop,
  clearDetailPanel: noop,
});
