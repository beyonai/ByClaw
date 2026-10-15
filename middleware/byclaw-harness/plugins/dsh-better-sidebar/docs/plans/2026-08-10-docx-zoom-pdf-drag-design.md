# Word 缩放与 PDF 拖拽修复设计

> 日期: 2026-08-10
> 状态: 已批准

## Word 缩放

- 默认 100%，范围 50%–200%，步进 10%。
- `Alt + 滚轮` 调整缩放并阻止 viewport 默认滚动。
- 底部固定 range slider，同步显示百分比。
- 使用 CSS `zoom` 缩放 docx-preview 专属容器，使滚动尺寸同步变化。
- 切换 Word 文件时恢复 100%。

## PDF 拖拽

- iframe 放入独立 stage。
- stage 内常驻透明 drag shield。
- Tab 拖拽或面板/分栏调整期间立即启用 shield；结束、取消或窗口失焦时关闭。
- shield 捕获 Chromium 内置 PDF viewer 吞掉的 dragover/pointer 流，正常状态不影响 PDF 交互。
