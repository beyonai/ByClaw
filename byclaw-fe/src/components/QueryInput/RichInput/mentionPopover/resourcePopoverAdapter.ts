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

/** 按展开方向使用实际可用空间，预留浮层间距及屏幕边缘，不设置会导致溢出的最小高度。 */
export const getResourcePopoverPanelHeight = (
  anchor: { top: number; bottom: number },
  placement: PopoverProps['placement'],
  viewportHeight: number,
  viewportTop = 0
): number => {
  const available = `${placement || 'topLeft'}`.startsWith('bottom')
    ? viewportTop + viewportHeight - anchor.bottom
    : anchor.top - viewportTop;
  return Math.max(0, Math.floor(available - 12 - 16));
};

/** 资源弹窗只依赖输入框宽度进行布局，不再使用光标坐标。 */
export const getResourcePopoverPosition = (open: boolean, width?: number): CSSProperties | undefined =>
  open ? { width } : undefined;

/** 两个入口共用的弹窗状态适配，调用方只需提供打开状态、宽度和输入框所在位置。 */
export const getResourcePopoverAdapter = ({ open, width, isInputAtBottom }: ResourcePopoverAdapterOptions) => ({
  popoverPos: getResourcePopoverPosition(open, width),
  placement: getResourcePopoverPlacement(isInputAtBottom),
});
