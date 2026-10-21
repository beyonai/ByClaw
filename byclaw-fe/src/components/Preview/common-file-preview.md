# 常用文件在线预览

## 格式与入口

- 聊天文件卡片悬停时统一显示预览按钮，不按文件格式清单隐藏；上传、预览请求或下载加载期间仍隐藏按钮。
  入口开放不增加解码格式支持，具体内容仍由现有预览器处理。
- `doc`、`ppt`：共享格式清单允许打开；`Office` 仅将这两种格式交给 `LegacyOffice`。
  前端通过现有带登录凭证的请求客户端，将已经下载的文件副本提交至
  `POST /byaiService/file-preview/legacy-office`，服务端返回 `application/pdf`。
- 原文件不覆盖、不改名、不落库。预览页顶部下载按钮仍使用原始 Blob；关闭或切换文件会取消转换请求并回收预览 URL。
- 微信、钉钉内置浏览器中的 `pdf` 使用现有 `@js-preview/pdf` Canvas 渲染，避免 Blob PDF 在 iframe 中触发下载；其它浏览器仍使用原生 iframe 预览。两种方式都保留原文件下载。
- `docx`、`xls`、`xlsx`、`pptx` 保留原渲染路径，不请求转换接口。
- `csv`、`tsv`：默认显示按行列排列的表格，可切换源码。第一行作为普通数据保留，不猜测表头。
  支持 UTF-8 BOM、CRLF、带引号的分隔符、转义双引号、单元格内换行和空单元格。
  单元格以 React 文本渲染，不执行 HTML 或公式。
- `rtf`：独立解析原始字节，支持正文、Unicode/常见 ANSI 编码和粗体、斜体、下划线等基本格式，图片显示占位说明。
- `ods`：独立读取 OpenDocument 表格，支持工作表切换和分页，展示保存的单元格值；没有保存值的公式显示为文本，不重新计算公式。
  保留重复行列、空单元格及合并区域的网格位置，表格单元格仅以 React 文本渲染。
- `odt`、`odp`：展示标题、段落、列表、基础表格和内嵌 PNG/JPEG；ODP 支持按幻灯片切换，以正文顺序阅读，不还原原始布局、字体、图形和动画。
- `ipynb`：只读展示 nbformat 4 笔记本的 Markdown、代码、原始文本以及保存的文本/PNG/JPEG 输出，每页 10 个单元格；不执行代码。
- `docm`、`dotx`、`xlsm`、`xltx`、`pptm`、`ppsx`、`potx`：校验 OOXML 包后生成静态预览副本，复用 DOCX/XLSX/PPTX 渲染器；不执行宏，下载保留原件。
- `eml`、`msg`：展示主题、发件人、收件人、抄送、时间、纯文本/HTML 正文、内嵌 CID 位图及附件列表，支持单独下载附件。
- 尚无预览器的 PSD、Parquet、非 SQLite 数据库、WPS、iWork、BZ2 等二进制格式不再落入纯文本兜底。
- `jpg`、`jpeg`、`jfif`、`jpe`、`jif`、`pjp`、`pjpeg`：统一按 JPEG 原生图片预览，Blob MIME 规范为 `image/jpeg`。
  文件列表、消息附件和 ZIP 子文件使用同一份格式清单；预览及下载保留原始文件名和扩展名。
- `heic`、`heif`、`hif`、`tif`、`tiff`、`jxl`：走独立图片解码器，支持缩放、旋转和重置，多图 HEIF/多页 TIFF 支持分页；TIFF 的方向/镜像标记会在显示时应用。
  HIF 复用 HEIF 解码器。仅解码当前页，顶部下载仍取原文件。通用 JPG/PNG 等格式继续使用原生图片路径。
- `raw`、`dng`、`cr2`、`cr3`、`nef`、`nrw`、`arw`、`srf`、`sr2`、`raf`、`rw2`、`orf`、`pef`、`srw`：交给相机 RAW 解码器，支持缩放、旋转和原件下载。
  扩展名允许打开不代表任意相机型号/压缩方式均能解码；失败时提示下载。HEIC/HEIF 序列仍不进入文本兜底。
- `epub`：按 EPUB 2/3 的 spine 顺序阅读章节，支持章节选择、前后翻章和书内插图。
- `sqlite`、`sqlite3`、`db`：仅对 SQLite 3 文件提供普通表的结构和数据分页预览；其他同名扩展数据库格式提示下载。
- `zip`、`rar`、`7z`、`tar`、`tar.gz`/`tgz`：列出包含子目录路径的文件列表，点击支持的文件后读取内容并交给现有预览器（TGZ 在列目录前先展开 gzip 层）；返回目录时释放子文件预览。
  不递归打开压缩包，不打开符号链接。压缩包内 HTML 使用独立沙箱显示静态内容，禁用脚本、导航及外部资源请求。

## photo_formats 样本补充

- 用户提供的 `photo_formats.zip` 包含 14 个图片样本和 `README.md`、`make_formats.py` 两个文本文件。
  JPG/PNG/GIF/BMP/WebP/ICO/AVIF 保留浏览器图片路径，HEIC/TIFF 保留已有解码路径；Markdown/Python 仅展示文本，不执行包内脚本。
  新增 JP2、PPM、TGA 的图片解码；`sample.png.alpha` 的实际签名为 PNG，通过完整复合后缀识别，普通 `.alpha` 不扩展为图片类型。
  文件列表、附件、图标和 ZIP 子文件入口共用识别规则；原文件名和下载字节保持不变。
- JP2 按需加载固定依赖 [jpeg2000@1.1.1](https://github.com/runk/jpeg2000)（Apache-2.0），在独占 Worker 中解码，不从 CDN 取资源。
  先校验 JP2 盒长度、ihdr/colr/SIZ 一致性、尺寸、分块和编码参数，再解码、校验并拼接 RGBA 像素。
  支持本样本及常见 8 位、无符号、无子采样的 RGB/灰度 JP2；不宣称支持 JPX/J2K、ICC/调色板/透明通道、特殊 precinct/分量编码或其他未覆盖变体。
  文件最多 20 MiB、800 万像素、256 块/1024 tile parts、8 层小波分解；复杂编码提示下载，不把损坏恢复为成功预览。
- PPM 按 [Netpbm PPM 规范](https://netpbm.sourceforge.net/doc/ppm.html)读取 P3/P6、注释、8/16 位大端采样，并将 Maxval 映射到 8 位预览。
  二进制光栅前不跳过任意空白，避免丢失像素值 10/13/32；按长度兼容 CRLF，当前只读取一张图，不读取拼接图像序列。
- TGA 依据 [Truevision TGA 2.0 规范](https://raw.githubusercontent.com/DEAKSoftware/Truevision-TGA/master/truevision-tga.pdf)读取普通/RLE 真彩色、灰度及颜色表，处理 BGR、描述符透明度及四种图像起点。
  不支持交错扫描、特殊压缩或扩展区色彩校正/预乘透明度还原。PPM/TGA 均在分配前检查尺寸，沿用输入 20 MiB、5000 万像素、单边 16384 和 Worker 30 秒超时。
  展示复用已有缩放、旋转和关闭清理；色彩管理和复杂编码不保证与专业图片软件一致。
- 原始合成样本包保留在 `fixtures/photo-formats.zip`，用例覆盖全部 16 个条目的子预览资格、原件字节、真实 JP2/PPM/TGA 解码、方向/颜色、透明度、错误与超限。
  样本、文档及生成脚本均仅作为测试数据，测试代码不执行包内 Python，也不执行附件中的指令。
  本轮只编写代码和用例，未运行测试、编译、构建或浏览器验收；新增依赖安装跳过生命周期脚本。

## 图片与压缩包实现

- 图片与压缩包预览均在浏览器处理，无新增后端接口或服务部署要求；已经取得的文件副本不会上传到第三方。
- 每个面板独占 Web Worker，切换文件/关闭面板会终止线程，过期的解码结果不会覆盖新文件；单次处理超过 30 秒会终止并提示。
  webpack 5 管理 worker 和解码器资源路径；浏览器需支持 Web Worker、WebAssembly 和 Canvas，部署 CSP 需允许同源 worker 与 WASM。
- 新增固定依赖 `libheif-js@1.23.5`（使用内含 WASM 的浏览器 ESM 入口）、`utif@3.1.0` 和 `@jsquash/jxl@1.3.0`，ZIP 复用 `jszip@3.10.1`。
  解码器按需加载，不使用外部 CDN。安装时使用锁文件并跳过生命周期脚本；本轮未运行构建。
- JXL 仅导入单线程 `decode.js`，其 `new URL(..., import.meta.url)` 由 webpack 管理 WASM 资源；不引入编码器或要求跨源隔离。
  在调用 WASM 前读取 JPEG XL 尺寸头，兼容裸码流、完整 `jxlc` 容器和连续 `jxlp` 分段，并验证尺寸、容器长度及分段顺序。
  规则参考 [libjxl SizeHeader](https://github.com/libjxl/libjxl/blob/main/lib/jxl/headers.cc) 和
  [格式说明](https://github.com/libjxl/libjxl/blob/main/doc/format_overview.md)。
- HEIF 支持范围取决于所用 libheif 构建的编码器能力，不承诺任意 HEIF 编码；TIFF 支持标准 TIFF，BigTIFF、损坏文件及不支持的编码提示下载。
  HEIF 多图按静态页面展示，不播放 Live Photo 动态内容。
- JXL 当前为 8 位静态图片预览，不播放动画，不承诺还原 HDR/广色域效果；页面展示对应说明，下载保持原文件。
- 依赖说明：[libheif-js](https://github.com/catdad-experiments/libheif-js)（LGPL-3.0）、
  [UTIF](https://github.com/photopea/UTIF.js)（MIT）、[jSquash](https://github.com/jamsinclair/jSquash)（Apache-2.0）、
  [JSZip](https://stuk.github.io/jszip/)（MIT / GPLv3 双许可证）。

## RTF 与 ODS 实现

- 两种格式均复用文件列表、消息附件和 ZIP 子文件入口，在浏览器处理已下载的文件；顶部下载始终保留原文件名和字节。
  不请求旧版 Office 转换接口，不新增后端接口或服务，不将文件发送到第三方。
- RTF 按需加载固定版本 [rtf.js@3.0.9](https://github.com/tbluemel/rtf.js)（MIT），使用实际 RTF 解析器处理编码与格式。
  由于解析器依赖 DOM，在主线程执行；先限制输入、嵌套深度、控制词数量和异常字体参数，关闭后忽略过期结果。
  超链接只展示文字，图片只调用占位回调，不展开 WMF/EMF；不提供 IMPORT 加载回调，不读取外部资源。
  结果经过 DOMPurify 标签/属性白名单清洗，再放入无脚本权限的 iframe，CSP 禁止网络和外部资源。
- ODS 复用 JSZip 并按需加载固定版本 [saxes@6.0.0](https://github.com/lddubeau/saxes)（ISC），按命名空间流式读取 UTF-8 `content.xml`。
  只展开 `mimetype` 和 `content.xml`，图片、宏、外链和嵌入对象不读取；不解析样式表和图表。
  在独立 Web Worker 内处理，单次超过 30 秒终止；完成、失败、切换文件和关闭面板均释放线程。
  对重复空行列只推进坐标，对非空重复数据先限额再展开，防止小文件通过重复计数占用巨量内存。

## Office 衍生格式与 EML 实现

- Office 变体单独进入 `OfficeVariant`，不直接将后缀映射成普通 Office 文件。
  worker 校验 ZIP 条目、`[Content_Types].xml` 主部件类型、根关系及主部件 XML 命名空间；扩展名与内容不符时提示下载。
  在内存副本中将主部件声明规范为 DOCX/XLSX/PPTX，移除 VBA、ActiveX、OLE 嵌入对象及外部关系；模板/放映按静态正文或幻灯片展示。
  下载按钮仍使用原件，不改扩展名、宏或原始字节；PPTX 原有孤立母版兼容处理继续应用于准备后的副本。
  不支持加密、非 UTF-8 包元数据、二进制 XLSB、旧版模板或未列出的其他变体；复杂控件/宏工作表不能保证还原。
- Office 变体输入最多 20 MiB、1000 个 ZIP 条目，单个实际解压部件最多 20 MiB、全部读取部件最多 50 MiB。
  元数据单份最多 2 MiB，主部件 XML 最多 100000 个节点、128 层；拒绝 DTD、符号链接和路径穿越。
  处理在独立 worker 内进行，30 秒超时，关闭/切换文件后丢弃旧结果；处理完成释放 worker。
- EML 使用固定版本 [postal-mime@3.0.1](https://github.com/postalsys/postal-mime/tree/v3.0.1)（MIT-0），兼容项目现有 Node 基线。
  新增依赖已写入 package.json 和锁文件，安装使用 `--ignore-scripts`，未运行生命周期构建；部署按锁文件安装即可。
  支持 MIME 编码头、UTF-8/解码器支持的历史字符集、base64、quoted-printable、multipart 正文和附件；嵌套邮件保留为附件，不递归合并正文。
  邮件输入最多 20 MiB、正文 UTF-8 合计 2 MiB、100 个附件、附件解码字节合计 20 MiB；MIME 最大深度 32、全部头部最多 256 KiB。
  解析前对行首 `--` 的候选分隔行计数，最多 1000 行（正文分隔线也计入），并复用 worker 30 秒超时及关闭释放机制。
  HTML 经 DOMPurify 标签/属性白名单清洗，放入 `sandbox=""` iframe；禁用脚本、表单、导航、远程图片及邮件样式。
  CID 仅匹配当前邮件中唯一 ID 的 PNG/JPEG/GIF/WebP 位图，最多 32 次图片引用、单图 2 MiB、唯一图片总量 8 MiB。
  缺失、重复、超限的 CID 图片不显示，仍保留附件下载；附件名移除路径/控制字符/双向覆盖字符，正文和地址均为不可信显示数据。
  不验证发件人身份或数字签名，不解密 S/MIME/PGP 邮件；HTML 复杂排版与原邮件可能不同。
  附件当前提供列表及下载，嵌套邮件、压缩包等不会在邮件面板内自动展开；最外层 EML 原件下载不变。
- 新增实际 ZIP/XML 与 MIME 消息解析用例，覆盖七种 Office 类型/声明验证、原件不变、宏/外链移除、中文编码、正文变体、CID、附件字节、损坏及超限输入。
  组件/入口用例覆盖 MIME 大小写、隐藏文件名、消息/文件/ZIP 路由、静态 iframe、错误提示、资源回收和切换文件竞态。
  本轮仅编写用例及静态检查，未执行测试、编译或构建；真实 Office 排版、邮件样本与浏览器 worker 打包仍需验收。

## MSG、RAR 与 7z 实现

- MSG 复用邮件面板、HTML 清洗、CID 位图及附件下载；按需加载固定版本
  [@kenjiuno/msgreader@1.29.0](https://github.com/HiraokaHyperTools/msgreader)（Apache-2.0）。
  先校验 CFB 头、分配表数量、MSG 属性流、目录深度 32、最多 10000 个目录/流、单流不超过输入长度、流声明总量 50 MiB，
  再解析主题、发件人、To/Cc、提交/投递时间、Unicode/常见 ANSI 代码页正文与普通附件。
  文件上限 20 MiB，正文 UTF-8 合计 2 MiB，最多 100 个附件、附件输出合计 20 MiB、1000 个收件人。
  含嵌套邮件的附件作为 MSG 文件下载，不递归渲染；保留附件原始字节（嵌入邮件由库重建为独立 MSG）。
  只含 RTF 的正文按 MS-OXRTFCP 解压并复用 RTF 预览器；正文损坏/超限时保留邮件信息和附件。引用型附件只展示名称及缺少内容提示，不请求本地路径或远程地址。
  S/MIME、联系人/日历等非邮件 Outlook 项目、不支持的代码页提示下载；不能保证所有旧版 MSG 变体。
- RAR/7z 使用固定版本 [libarchive-wasm@1.2.0](https://github.com/ofk/libarchive-wasm)（封装 MIT，libarchive BSD 许可）。
  支持该构建可读取的普通 RAR4/RAR5 和 7z 文件；先检查实际签名，拒绝 RAR 分卷标记、加密头及加密条目。
  不处理自解压 EXE、分卷合并或密码输入。WASM 按需从站点同源资源加载，只对该依赖的 Node 分支设置 webpack 局部别名。
  复用 ZIP 列表、分页、返回目录及子文件预览；ZIP 继续由 JSZip 处理。
  输入 20 MiB、1000 条目、声明展开总量 50 MiB，单文件实际解压最多 20 MiB，文本/SVG/HTML 2 MiB。
  列目录只取元数据、跳过内容；点选时重开归档，以 64 KiB 块读取并累计实际输出，还校验声明/实际大小相符。
  固实压缩包在跳过或读取后续文件时可能由底层解码先前数据；50 MiB 是声明展开预算，并非 WASM 堆内存硬上限。
  每次操作沿用 30 秒超时，关闭面板终止独占 worker；所有路径在 finally 释放句柄及临时内存。
  拒绝不安全/重复路径，符号链接、硬链接、设备条目和所有嵌套 ZIP/RAR/7z/TAR/TGZ/GZ 不开放子预览。
  库将目录 EOF 和失败都返回空指针，因此额外检查错误信息，损坏包不显示为成功的空目录。
- 新增真实 RAR4/RAR5/7z 解码样本用例、合成 CFB/MSG 内容用例、异常接口模拟用例，覆盖文件签名、中文编码、附件字节、
  RTF 正文/损坏提示与引用附件提示、加密与分卷拒绝、路径/重复/链接、声明及实际解压上限、损坏目录、资源释放、worker 传输和各入口原件下载。
  压缩样本来源与许可证保存在 `fixtures/native-archive/`，无用户文件；新增依赖已安装并锁定，安装跳过生命周期脚本。
  本轮仅补代码/用例与静态检查，未运行测试、编译或构建；浏览器 WASM/worker 资源加载、真实 Outlook 邮件和复杂压缩方式仍需验收。

## TAR、GZIP 与 MSG 富文本正文补充

- TAR 复用 libarchive 解码器，校验首块校验和及块对齐，兼容 ustar/PAX 等该解码器支持的 TAR 变体。
  归档根目录 `.`/`./` 省略，条目开头 `./` 规范化后展示；内部 `.`/`..`、绝对路径、反斜杠和重复路径仍拒绝。
  复用 1000 条目、输入 20 MiB、声明内容合计 50 MiB 和单文件实际读取上限；链接、设备文件及嵌套归档只列名称。
- `.tar.gz` 与 `.tgz` 统一为 TGZ；`.gz` 按单文件处理，内部名称为 `.tar` 时再打开 TAR。
  GZIP 在 worker 内使用浏览器原生 `DecompressionStream('gzip')`，流式累计实际输出并验证流完整性。
  压缩输入最多 20 MiB，TGZ 展开后的整个 TAR（含头和填充）最多 50 MiB；单文件 GZ 采用 20 MiB/文本 2 MiB 上限。
  GZIP 层需要在列目录前展开；子文件转移独立副本，重复打开不会分离缓存。无此浏览器 API 时提示下载，不添加 CDN 或服务端转码。
  单文件名称优先使用外部名称去掉 `.gz`，其次使用 gzip FNAME；无可识别扩展名时只列出，不猜测为文本。
  单文件 GZ 与其他压缩包均保留原始压缩文件下载，不递归打开嵌套归档；此次无新增依赖。
- MSG 的 RTF 正文参考 [MS-OXRTFCP](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxrtfcp/a1f226ed-31e3-4565-9d26-af3c6714c93f)。
  在没有 HTML/纯文本正文时读取 LZFu/MELA；解压前校验头部长度和 2 MiB 原文上限，LZFu 校验 CRC、字典引用与结束标记。
  解码后的独立缓冲区转移到主线程，复用现有 RTF 复杂度校验、DOMPurify 清洗及无权限 iframe。
  基本文字/格式可读，图片仍为占位，不保证复杂表格、分页及字体还原；正文错误不影响邮件头和附件下载。
- 增加合成真实 TAR/GZIP 和官方压缩 RTF 样例用例，覆盖复合后缀、重复打开、原件保留、损坏/超限、路径/链接、worker 路由和界面分流。
  本批仅编写用例及执行静态检查，不运行测试、编译、构建；浏览器 GZIP/worker/WASM 加载和真实邮件排版仍需验收。

## ODT、ODP 与 IPYNB 实现

- 共用文件列表、消息附件与 ZIP 子文件入口，下载保留原始文件名和字节；在独立 worker 内解析，无新增依赖或后端接口。
  文件上限 20 MiB，单次请求 30 秒超时；成功、失败、关闭或切换文件均释放 worker，丢弃旧文件结果。
- ODT/ODP 复用 JSZip 和 saxes，校验 `mimetype` 与 `content.xml` 的正文类型，按命名空间读取。
  ZIP 最多 1000 个条目，正文实际解压最多 8 MiB、2 万 XML 节点、128 层；生成正文 HTML 最多 2097152 个 JavaScript 字符，ODP 最多 200 页。
  最多读取 50 个归档内 PNG/JPEG 引用，单图 2 MiB、图片总量 8 MiB；拒绝路径穿越、符号链接、DTD、脚本和外部资源。
  重复行列不展开，合并结构按普通单元格显示；有省略内容时提示。缺失/不支持的图片省略，超限则提示下载。
  文本转义后再次经过 DOMPurify 白名单清洗，在无权限 iframe 中展示，CSP 禁止脚本、网络和表单；只允许内嵌 PNG/JPEG。
- IPYNB 按 [Jupyter nbformat 4 结构](https://nbformat.readthedocs.io/en/latest/format_description.html) 读取字符串或字符串数组形式的 source/output。
  最多 1000 个单元格、合计 1000 个输出，单段文本展示前 100000 字符，文本总量最多 2097152 字符，超出单段时提示截断。
  单张图像 base64 文本最多 2 MiB，图片 base64 总量最多 8 MiB。无可展示内容的 HTML/SVG/widget 输出会省略并提示；有 text/plain 时使用纯文本版本。
  Markdown 禁用 HTML，链接仅保留文字，图片/附件不加载；代码、终端输出和报错均作为 React 文本展示，内核、宏和 JavaScript 不执行。
- ODF 元素参考 [OASIS OpenDocument 1.3 Schema](https://docs.oasis-open.org/office/OpenDocument/v1.3/OpenDocument-v1.3-part3-schema.html)。
  本轮补充真实 ZIP/XML、Notebook JSON 解析、资源隔离、大小限制、分页、文件切换、worker 路由和入口/原件下载用例；未执行测试、编译或构建，真实文档排版仍需浏览器验收。

## EPUB、SQLite 与相机 RAW 实现

- 三类预览共用文件列表、消息附件及 ZIP 子文件入口，顶部下载保留原始文件字节、名称和扩展名。
  在独立 worker 中处理已经下载的副本；切换文件和关闭面板终止线程，过期结果丢弃。每次请求仍有 30 秒超时。
  本轮只改前端，不新增后端接口、数据库迁移或第三方上传。
- EPUB 复用 JSZip、saxes 和 DOMPurify。读取 `META-INF/container.xml`、OPF manifest/spine 和可选 EPUB 3 nav / EPUB 2 NCX 目录。
  UTF-8 章节正文和图片按需解压，所有路径必须留在归档内且与 manifest 相符；拒绝符号链接和内部实体声明，不读取外部实体。
  正文清洗后放入 `sandbox=""` 的 iframe，CSP 禁止网络、脚本、表单和导航；保留书内图片、基本段落及表格，去除书籍 CSS、字体、脚本、外链与嵌入媒体。
  复杂/固定版式不承诺还原；含 `META-INF/encryption.xml` 的书籍（含字体混淆）提示下载；目录缺失时使用章节编号。
- SQLite 按需加载固定版本 [sql.js@1.15.0](https://github.com/sql-js/sql.js)（MIT）的浏览器 WASM 入口。
  校验 SQLite 3 文件头并创建内存副本，设置 `trusted_schema=OFF`、`query_only=ON`、`cell_size_check=ON`。
  只列出普通表和普通存储列，跳过视图、虚拟/影子表、隐藏/生成列；不执行用户 SQL、触发器或扩展。
  标识符双引号转义、查询值绑定；整数由 SQLite 转为文字后返回以保留 64 位精度，BLOB 仅显示长度，TEXT 在 SQLite 内截断。
  支持切换数据表、查看列类型/主键/非空标记、前后分页；不写回文件、不编辑、不提供数据库连接。
  使用已完成写入/检查点的独立文件；不会合并 `-wal`/`-shm`，SQLCipher/其他加密数据库不支持。
- RAW 按需加载固定版本 [@colorhythm/libraw-wasm@1.1.1](https://github.com/colorhythm/libraw-wasm) 的单线程 LibRaw 构建（绑定 MIT，LibRaw 使用其 LGPL/CDDL 双许可）。
  webpack 输出同源 WASM；仅对该依赖加载器使用局部 Node 模块别名，不添加跨源隔离配置或 CDN 请求。
  生产 JavaScript 使用 Terser 压缩，避免依赖中的 BigInt 字面量被 esbuild 的旧目标配置拒绝。
  切换压缩器不提供 BigInt polyfill；RAW 解码仍要求浏览器原生支持 BigInt、相关类型化数组及所需 WASM 能力。
  在 unpack 前校验传感器尺寸，使用 half-size、相机白平衡、8 位 sRGB 生成预览，再将显示长边限制为 4096。
  LibRaw 的 processed image 已应用相机方向，不再次旋转；完成/失败释放句柄，关闭面板释放 WASM 内存。
  RAW 显色与相机软件可能不同，不做 RAW 编辑，不承诺所有相机/压缩组合可读。
- EPUB 输入上限 20 MiB、1000 个 ZIP 条目、500 章；单份元数据/章节展开最多 2 MiB，XML 最多 2 万节点、128 层。
  每章最多请求 32 个插图源，单图最多 4 MiB、合计 8 MiB；无法读取的插图省略，正文继续阅读。
- SQLite 输入上限 50 MiB、200 个非系统表/视图条目；每表前 100 列、1000 行，每页 50 行，文本每格 512 个 JavaScript 字符，超出明确提示。
  不执行全表 COUNT 来获取总行数，每页多取一条判断下一页；无排序控件，按文件内当前扫描顺序展示。
- RAW 输入上限 50 MiB、传感器 1 亿像素且单边不超过 20000，解码结果仍受通用图片像素上限约束。
  从 ZIP 打开时，同时受 ZIP 单文件实际解压 20 MiB 上限约束。
- 新增真实 EPUB ZIP/OPF/目录/章节解析及 SQLite 引擎文件用例，覆盖章节顺序、相对图片路径、加密/实体/符号链接、展开上限、表结构、引号标识符、64 位整数、NULL/BLOB、分页与截断。
  RAW 用例模拟解码器接口，覆盖尺寸预检、处理参数、RGBA 转换、错误释放；不代表已用真实相机样本验证像素。
  组件及入口用例覆盖分流、原件下载、分页/结构切换、沙箱清理、失败提示、worker 路由及切换文件竞态。
  按本项目约定，本轮仅编写用例，不运行测试、编译或构建；浏览器中的 worker/WASM 加载、EPUB 排版和真实 RAW 仍需验收。

## 边界

- 旧版 Office 转换输入最大 20 MiB，仅接受 DOC/PPT 扩展名及 OLE2 文件头；空文件、损坏或加密文件返回可识别错误。
- DOC 复用 Apache POI / OpenPDF，按原顺序处理段落、基本表格和可解析图片；复杂合并单元格、页眉页脚、浮动布局可能与原文件不同。
- PPT 用现有 Apache POI HSLF 逐页绘制静态图像并生成 PDF，最多 100 页；不播放动画和嵌入媒体。
  字体及复杂图形效果受服务器字体和 POI 渲染能力影响。无需新增 LibreOffice 服务。
- CSV/TSV 表格文本最大 2 MiB，最多展示 1000 行、100 列，每页 50 行；超出展示范围有提示，原始源码和下载保持完整。
  表格读取使用现有 UTF-8 文本路径；引号不闭合等语法错误提示切换源码，不展示可能错列的结果。
- RTF 输入最多 2 MiB、128 层分组、2 万个分组/控制词；生成节点最多 4 万、HTML 最多 8 MiB。
  仅提供正文和基本格式预览，嵌入对象不展示，复杂表格、页眉页脚、分页和字体排版可能与原文件不同。
- ODS 输入最多 20 MiB、1000 个 ZIP 条目、50 张工作表，实际展开正文 XML 最多 8 MiB。
  每表展示前 1000 行、100 列，每页 50 行，单元格文字最多 4096 字符；全工作簿保留网格最多 10 万格、文字最多 2097152 字符（按 JavaScript 字符串长度计）。
  超出行列/文字展示范围提示截断，超出解压或总量限制提示下载；空白尾部不展开。
  合并区域按普通网格展示，图表、图片、复杂样式和公式重算不支持；加密、损坏、非 UTF-8 正文及不支持的结构提示下载。
- 接口沿用现有登录拦截器，参数为文件内容，不接受远程 URL 或存储路径，不增加文件访问权限。
- HEIF/TIFF/JXL 图片预览输入最多 20 MiB、100 页，单页最多 5000 万像素且任一边不超过 16384；超出限制仍可下载。
  展示副本长边最多 4096 像素，缩放/旋转不修改原文件。TIFF 暂不支持分平面布局及解码器未实现的色彩/位深组合。
- ZIP 最多 20 MiB、1000 个目录/文件条目，单个文件实际解压输出最多 20 MiB，文本/SVG/HTML 最多 2 MiB。
  限制按真实解压字节累计，不信任压缩包声明的大小；不在列目录时解压全部文件。
  加密 ZIP、绝对路径、路径穿越和含反斜杠的条目不支持。文件名优先使用 UTF-8；未标记编码的旧 ZIP 尝试 GB18030。

## 回归范围

前端用例覆盖格式识别、转换请求、切换文件竞态、取消及 URL 回收、转换失败和大小限制、
表格解析、分页、源码切换、原文件下载及原有格式分流。后端用例覆盖 multipart 响应、
类型/文件头/大小校验、双语错误、真实 DOC 内容与表格、真实 PPT 页数及 PDF 内容资源。

新增用例覆盖真实双页 TIFF 的像素/方向与重复翻页、HEIF 解码器接口及句柄释放、ZIP 真实解压及展开大小限制、
非法路径/符号链接/嵌套 ZIP、后台线程超时与终止、文件切换竞态、图片缩放旋转、ZIP 子文件分流及 HTML 隔离。
照片扩展用例覆盖 JPEG 别名及 HIF/JXL 各入口的分流/MIME/图标/原始下载名、ZIP 内照片识别、未支持二进制照片的文本兜底禁用，
以及 JXL 尺寸头/分段容器/溢出/截断校验、透明度/方向/解码失败与关闭竞态。
HEIF、JXL 像素解码用例模拟解码器接口，尺寸头用例不代表完整 JXL 文件能解码；真实 HEIC/HIF/JXL 样本和浏览器 worker/WASM 打包结果仍需后续验收。

RTF 新增真实解析器用例，覆盖 Unicode/GBK 中文、基本格式、链接及图片处理、外部 IMPORT 禁用、HTML 文本转义和输入复杂度限制。
ODS 新增真实 ZIP/XML 用例，覆盖多工作表、保存值/公式文本、空白与合并位置、重复行列、截断、实际解压上限、非法 XML/路径及符号链接。
组件用例覆盖分页、切换工作表/文件、旧结果丢弃、worker 释放、超限/失败提示；入口用例覆盖格式识别、图标和原件下载。
以上用例本轮仅编写，未执行测试、编译或构建；RTF 排版和 ODS Worker 打包还需浏览器验收。

真实文件的排版、中文字体及部署环境兼容性仍需浏览器验收；添加测试用例不代表已经执行通过。
