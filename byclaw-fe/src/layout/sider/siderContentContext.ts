import { createContext } from 'react';
import { noop } from 'lodash';

export const DEFAULT_SIDER_CONTENT_WIDTH = 280;

export type DetailPanelOptions = {
  width?: number | string;
};

export const SiderContentContext = createContext<{
  siderContentWidth: number;
  setSiderContentWidth: React.Dispatch<React.SetStateAction<number>>;
  setDetailPanel?: (panel: React.ReactNode, options?: DetailPanelOptions) => void;
  clearDetailPanel?: () => void;
    }>({
      siderContentWidth: DEFAULT_SIDER_CONTENT_WIDTH,
      setSiderContentWidth: noop,
      setDetailPanel: noop,
      clearDetailPanel: noop,
    });
