# PDF 原生预览设计

> 日期: 2026-08-10
> 状态: 已批准
> 范围: `dsh-better-sidebar` 的 `EditorView` 文件预览扩展

## 目标

为 `.pdf` 增加侧边栏内预览，同时保持零新增前端依赖和现有下载降级出口。

## 方案

- Client 按扩展名识别 `.pdf`，短路 `fsRead` 的二进制探测。
- `PdfView` 通过 `fetch(mediaUrl(scope, path))` 读取字节，创建显式
  `application/pdf` Blob URL 后交给浏览器原生 `<iframe>`，避免旧 host
  或代理缓存 `application/octet-stream` 时触发直接下载。
- Host media route 为 `.pdf` 返回 `application/pdf`。
- PDF 预览工具条始终提供“下载查看”链接。
- 不引入 PDF.js，不实现缩略图、文本搜索或自定义翻页工具栏。

## 错误与限制

- 是否可渲染取决于浏览器内置 PDF 查看器。
- 文件仍受现有 `mediaLimit` 限制。
- 浏览器原生 PDF iframe 对 HTTP 错误没有统一可观测事件；下载链接作为稳定降级出口。

## 测试

- `.pdf` 扩展名识别为 PDF 预览。
- media type helper 对 `.pdf` 返回 `application/pdf`。
- Typecheck、bundle purity、manifest/plugin-shape 测试通过。
