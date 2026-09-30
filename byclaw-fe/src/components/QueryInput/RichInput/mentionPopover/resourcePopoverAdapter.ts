import type { PopoverProps } from 'antd';
import type { CSSProperties } from 'react';

export interface ResourcePopoverAdapterOptions {
  open: boolean;
  width?: number;
  isInputAtBottom?: boolean;
  placement?: PopoverProps['placement'];
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

/** 优先使用页面指定的展开方向，兼容尚未发起会话但输入框已位于底部的员工详情页。 */
export const getResourcePopoverAdapter = ({ open, width, isInputAtBottom, placement }: ResourcePopoverAdapterOptions) => ({
  popoverPos: getResourcePopoverPosition(open, width),
  placement: placement ?? getResourcePopoverPlacement(isInputAtBottom),
});
