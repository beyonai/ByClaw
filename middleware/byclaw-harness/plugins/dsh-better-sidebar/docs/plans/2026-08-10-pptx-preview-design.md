# PPTX 高保真预览设计

> 日期: 2026-08-10
> 状态: 已批准
> 范围: `dsh-better-sidebar` 的 `.pptx` 浏览器预览

## 目标

使用 `@aiden0z/pptx-renderer` 在侧边栏内预览 `.pptx`，保留图片、表格、
图表、SmartArt 与常见 OOXML 样式，同时保持下载降级出口。

## 架构

- `.pptx` 从 `download-only` 调整为独立 `pptx` 预览类型。
- `PptxView` 从现有 media route 获取 `ArrayBuffer`。
- 使用 `PptxViewer.open()` 渲染到库专属 DOM 容器。
- 开启 `lazyMedia`、`lazySlides` 与推荐 ZIP 安全限制。
- UI 提供上一页、下一页、页码和下载按钮。
- 卸载时销毁 viewer 并清空库专属容器。
- 旧 `.ppt/.doc/.xls` 继续仅下载。

## Bundle

- 先验证普通 bundler 入口不会遗留 Node builtin `require()`。
- 若普通入口不纯，切换包提供的 standalone browser ESM 入口。
- 不启用可选 PDF.js EMF fallback，避免额外体积。

## 错误处理

- 损坏、加密或超限文件显示错误信息和下载链接。
- viewer 初始化失败时清理部分创建的实例与 DOM。

## 测试

- `.pptx` 类型分发。
- bundle 模块表 require guard。
- Typecheck、manifest/plugin-shape 与构建通过。
