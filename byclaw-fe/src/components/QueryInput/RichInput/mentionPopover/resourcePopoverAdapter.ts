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

/** 按展开方向计算可用空间并预留浮层间距及屏幕边缘，内容最小高度也必须受此空间约束。 */
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

/** 分类减少时仍给右侧列表保留 320px 阅读空间；空间不足时压缩面板并沿用内部滚动。 */
export const getResourcePopoverContentHeight = (availableHeight: number, navigationHeight: number): number =>
  Math.min(availableHeight, Math.max(320, navigationHeight));

/** 资源弹窗只依赖输入框宽度进行布局，不再使用光标坐标。 */
export const getResourcePopoverPosition = (open: boolean, width?: number): CSSProperties | undefined =>
  open ? { width } : undefined;

/** 优先使用页面指定的展开方向，兼容尚未发起会话但输入框已位于底部的员工详情页。 */
export const getResourcePopoverAdapter = ({
  open,
  width,
  isInputAtBottom,
  placement,
}: ResourcePopoverAdapterOptions) => ({
  popoverPos: getResourcePopoverPosition(open, width),
  placement: placement ?? getResourcePopoverPlacement(isInputAtBottom),
});
