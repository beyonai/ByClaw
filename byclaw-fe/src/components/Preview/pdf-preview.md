# PDF 二进制预览

对应 Issue #270，沿用 HACU 的修复方式。

消息预览会向 `PreViewFile` 传入相对资源解析器。若 PDF 进入 HTML 资源解析分支，
`HtmlRender` 会将 Blob 读取为文本并包装成 HTML，导致二进制内容被错误展示。

`PreViewFile` 对 PDF 跳过该分支，将原始二进制生成的 Blob URL 交给 iframe，
由浏览器内置 PDF 查看器渲染。现有文件名和 MIME 类型处理、下载及 URL 回收逻辑继续复用。
HTML、H5 和 Markdown 保留原有的相对资源处理方式。

`Twins.test.tsx` 覆盖有、无相对资源解析器时的 PDF 参数传递、MIME 类型、数据大小、
URL 回收、HTML/H5 相对资源解析，以及 PDF 切换到 Markdown 的回归场景。
用例使用模拟 PDF 和渲染器；真实中文显示仍需使用原问题 PDF 在浏览器中验收，
分别检查上传和 Agent 生成文件的消息预览入口。
