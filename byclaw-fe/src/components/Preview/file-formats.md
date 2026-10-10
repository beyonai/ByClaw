# 文件预览格式

消息附件、会话/项目文件、文件浏览器、知识目录及成果文件统一使用 `formats.ts` 和 `PreViewFile`。
列表的可预览判断、扩展名别名、MIME 与内容渲染使用同一份清单。

- 图片：PNG、JPEG/JPG、GIF、BMP、WebP、SVG、ICO、AVIF、APNG。SVG 使用图片元素展示，提供 XML 源码页签；不进入 HTML 资源解析分支。
- 文档：PDF、DOCX、XLSX、PPTX 沿用已有预览组件；XLS 使用已安装 Excel 库的 `xls: true` 转换选项。
- 文本：Markdown/MD、TXT、LOG、JSON、JSONL、NDJSON、CSV、TSV、XML 以及原有代码/配置格式。CSV/TSV 以原文展示，不更改字段或内容。HTML/HTM/H5 保留原有 HTML 及相对资源预览。
- 视频：MP4、WebM、MOV、M4V、OGV、AVI、MKV。
- 音频：MP3、WAV、OGG/OGA、Opus、M4A、AAC、FLAC。

音视频使用原生播放控件，不自动播放；切换文件或卸载时停止播放。容器扩展名不能保证浏览器支持其中的编码，不支持的编码或损坏媒体显示提示并保留下载。图片解码失败同样显示提示。
浏览器格式和编码能力参考 [MDN 图片格式说明](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Image_types) 和 [MDN 媒体格式说明](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats)。

旧版 DOC/PPT、TIFF/TIF、HEIC/HEIF、压缩包等尚无通用在线解析器，不声明为可预览格式。
文件面板不得把这些二进制格式当作未知文本读取；直接传入共享渲染器时显示不支持提示并保留 Blob 下载。
这些格式的直接预览需要额外的解析库或后端转换服务，不能仅通过增加白名单实现。

PDF 始终保留原始二进制 Blob URL，不进入 HTML 相对资源读取分支。
切换文件后丢弃旧异步文本读取结果；本组件创建的 Blob URL 在切换或卸载时回收，Office 仅在下载时创建临时 URL。

回归用例位于 `formats.test.ts`、`Twins.test.tsx`、`Image.test.tsx`、`Media.test.tsx`、`Office.test.tsx` 及各入口对应测试文件。
