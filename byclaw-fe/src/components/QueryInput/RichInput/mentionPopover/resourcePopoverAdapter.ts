import type { PopoverProps } from 'antd';
import type { CSSProperties } from 'react';

export interface ResourcePopoverAdapterOptions {
  open: boolean;
  width?: number;
  isInputAtBottom?: boolean;
}

/** 资源弹窗统一定位：历史会话在输入框上方，新会话/任务在输入框下方。 */
export const getResourcePopoverPlacement = (isInputAtBottom?: boolean): PopoverProps['placement'] =>
  isInputAtBottom ? 'topLeft' : 'bottomLeft';

/** 资源弹窗只依赖输入框宽度进行布局，不再使用光标坐标。 */
export const getResourcePopoverPosition = (open: boolean, width?: number): CSSProperties | undefined =>
  open ? { width } : undefined;

/** 两个入口共用的弹窗状态适配，调用方只需提供打开状态、宽度和输入框所在位置。 */
export const getResourcePopoverAdapter = ({ open, width, isInputAtBottom }: ResourcePopoverAdapterOptions) => ({
  popoverPos: getResourcePopoverPosition(open, width),
  placement: getResourcePopoverPlacement(isInputAtBottom),
});
