import { createContext } from 'react';
import { noop } from 'lodash';

export const DEFAULT_SIDER_CONTENT_WIDTH = 280;

export const SiderContentContext = createContext<{
  siderContentWidth: number;
  setSiderContentWidth: React.Dispatch<React.SetStateAction<number>>;
}>({
  siderContentWidth: DEFAULT_SIDER_CONTENT_WIDTH,
  setSiderContentWidth: noop,
});
