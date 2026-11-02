# 文件预览格式

消息附件、会话/项目文件、文件浏览器、知识目录及成果文件统一使用 `formats.ts` 和 `PreViewFile`。
列表的可预览判断、扩展名别名、MIME 与内容渲染使用同一份清单。

- 图片：PNG、JPEG/JPG、GIF、BMP、WebP、SVG、ICO、AVIF、APNG。SVG 使用图片元素展示，提供 XML 源码页签；不进入 HTML 资源解析分支。
- 文档：PDF、DOCX、XLSX、PPTX 沿用已有预览组件；XLS 使用已安装 Excel 库的 `xls: true` 转换选项。
- 文本：Markdown/MD、TXT、LOG、JSON、JSONL、NDJSON、CSV、TSV、XML 以及原有代码/配置格式。CSV/TSV 默认以只读表格展示，可切换源码；复用 `Delimited` 的分页和引号/换行解析，不更改下载内容。HTML/HTM/H5 保留原有 HTML 及相对资源预览。
- 视频：MP4、WebM、MOV、M4V、OGV、AVI、MKV。
- 音频：MP3、WAV、OGG/OGA、Opus、M4A、AAC、FLAC。

音视频使用原生播放控件，不自动播放；切换文件或卸载时停止播放。容器扩展名不能保证浏览器支持其中的编码，不支持的编码或损坏媒体显示提示并保留下载。图片解码失败同样显示提示。
浏览器格式和编码能力参考 [MDN 图片格式说明](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Image_types) 和 [MDN 媒体格式说明](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats)。

当前分支还提供旧版 DOC/PPT 转 PDF、HEIF/TIFF/JXL/RAW 图片、ZIP、RTF、ODS、EPUB 和 SQLite 预览，
其部署要求与解码边界见 `common-file-preview.md`。本次优化复用这些实现。
未接入预览器的 DOCM、XLSM、XLSB、PPTM、ODT/ODP 等二进制文件不能落入文本兜底。
README、.gitignore 等文本候选统一开放入口，读取后检查控制字节；文本统一限制为 2 MiB，超限/非文本提示下载。
已知文件名后缀优先于过期的 fileType，例如 HTML 不会因为 fileType=txt 而只显示源码。

回答正文与 Markdown 附件共享按需加载的本地 Mermaid 组件，支持 mermaid/mmd 围栏、图形/源码切换、复制和放大。
回答流式输出只对真实闭合的围栏绘图，不把 Markdown 临时补全的闭合标记当作完整图。
语法错误保留源码并提示；切换内容后丢弃过期结果。渲染启用 strict 模式并限制文本/边数，不使用 CDN。

HTML 的相对图片、srcset、音视频、CSS（含带引号/无引号 @import、url 和字体）及内联/外部 JS 模块依赖按原资源目录解析。
失败资源列出路径；关闭/切换后释放所有生成的 Blob URL。此能力用于静态产物，不包含源码编译/开发服务器。
JS 动态计算的资源地址和循环模块依赖可能仍需产物自行使用可访问 URL；循环依赖会保留地址并提示。

文件加载检查 HTTP 状态和空内容，关闭/切换会取消请求或丢弃旧结果；DOCX/Excel 解析失败显示错误。
公共文件预览读取失败返回非 2xx 状态，空内容返回 422，成功响应禁用缓存，下载仍保留原始内容。

PDF 始终保留原始二进制 Blob URL，不进入 HTML 相对资源读取分支。
切换文件后丢弃旧异步文本读取结果；本组件创建的 Blob URL 在切换或卸载时回收，Office 仅在下载时创建临时 URL。

回归用例位于 `formats.test.ts`、`Twins.test.tsx`、`Image.test.tsx`、`Media.test.tsx`、`Office.test.tsx` 及各入口对应测试文件。

## 优化验证记录（2026-10-18）

基于 `D0.5.1` 的 `f4df86a04`，保留分支已实现的格式与转换能力。本次无数据库迁移。

- Node 18.20.8，使用固定依赖和锁文件完成安装、Umi 初始化及生产构建。
- 主体修改后的前端全量 Jest：457 组通过，4 组跳过；4330 个用例通过，47 个跳过。
  最终补充的知识库入口、竞态、HTML/JS 资源、文本限制及 Mermaid 回归结果见下方普通浏览器补验记录。
- 后端 `mvn -B -f byclaw-be/pom.xml verify`：4814 个用例，无失败或错误，25 个跳过。
- 本次修改文件的 ESLint 与 Prettier 检查通过；全库 Less 样式检查通过。
- 全库 ESLint 仍有 63 条位于未修改文件中的既有错误（主要为模型管理等模块的缩进/声明顺序）。
  全库 TypeScript 检查也仍有既有错误，生产构建不等同于全库类型检查通过。
- 本地浏览器验收页使用真实的回答 Markdown、附件 Markdown 组件及 Mermaid 引擎，验证流程图、时序图、ER 图、甘特图、
  多图、源码切换、放大、流式未闭合等待和错误回退。登录、服务和国际化使用验收替身，不代表线上登录后的完整链路验收。
- HTML 资源用例使用真实模块词法分析器，验证 CSS 导入、字体/图片路径、JS 导入、循环依赖、资源失败和 URL 生命周期。

### 普通浏览器补验（2026-10-18）

- Chrome、Safari 使用真实 `HtmlRender` 和资源解析器，在本机 HTTP 验收页内加载 Blob iframe，均通过 11 项检查：
  普通外部脚本、内联脚本、模块静态/动态导入及转导出、嵌套 CSS、背景图片、字体、相对图片、srcset、
  无引号 CSS 导入、导入 CSS 中的图片及内联模块相对导入。
- 补齐验收发现的两处遗漏：内联模块相对依赖改写、无引号 `@import url(...)` 的递归资源解析；加入对应回归用例。
- Safari 另外验证资源缺失时正文保留且显示具体失败路径、替换内容清除旧预览、关闭与重新打开正常。
- 修复后的专项 Jest 回归 51 组、562 个用例全部通过；改动文件 ESLint、Prettier 及全库样式检查通过。
- 全量复验时，已有模型管理表单用例在 20 秒超时后影响后续用例。经确认，仅将该长流程用例的超时设为 60 秒，
  保留全部断言及其他用例的超时限制，随后按仓库原始提交钩子重新执行检查。
- 此验收使用本地组件和资源替身，覆盖真实浏览器渲染及脚本执行；未部署至线上环境，不代表线上完整链路验收。
