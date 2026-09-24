# PPTX 预览兼容

部分生成或合并的 PPTX 在 `[Content_Types].xml` 中残留不存在、也未被关系文件引用的母版声明。
`pptx-preview` 1.0.7 遍历声明时会中断解析并吞掉异常，出现零页黑屏。

`preparePptxPreview` 仅在 PPTX 预览内存副本中移除这类母版声明。现存母版、其他文件内容、
原始下载文件均保留；真实被引用但缺失的母版仍作为损坏文件报错。没有残留声明时直接使用原缓冲区。
渲染库返回零页时使用现有国际化错误提示。PDF、DOCX、XLSX 的预览路径不经过此处理。

回归用例位于 `preparePptxPreview.test.ts` 和 `Office.test.tsx`，覆盖孤立声明、真实缺失、
正常文件不变、预览副本传递、零页错误以及其他 Office 格式分流。
