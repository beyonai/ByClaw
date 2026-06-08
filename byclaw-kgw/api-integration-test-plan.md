# 接口级集成测试场景方案

本文档从用户旅程出发，整理 `knowledge_base` 的接口级集成测试场景，方便直接查看”有哪些场景、覆盖了什么、哪些已经落代码”。

> **注意：** 所有路由已统一使用 camelCase URL，响应统一使用 `resultCode`/`resultMsg`/`resultObject` 信封格式。`knowledge_build` 独立路由已全部移除，构建功能整合到 `/api/v1/fileToMarkdownIndex`。

参考依据：

- `docs/modules/knowledge/api.md`
- `src/by_qa/knowledge_base/api/routes.py`
- `src/by_qa/knowledge_base/api/schemas.py`

说明：

- `状态` 分为 `已写`、`已写部分`、`待补`、`已弃用`
- `已写` 表示当前仓库已经有对应集成测试代码
- `已写部分` 表示该用户场景只覆盖了其中一部分链路
- `已弃用` 表示对应路由已移除，场景不再适用
- 本轮只写方案和测试代码，不执行测试

## 多级目录专项场景总表

说明：

- 这组场景专门看多级目录树，不只看单层目录
- 重点验证祖先节点、父节点、子节点、孙节点之间的状态联动

| 编号 | 用户角色 | 用户目标 | 典型调用链 | 核心预期 | 状态 |
| --- | --- | --- | --- | --- | --- |
| D1 | 目录管理员 | 创建三级目录树 | `knowledgeBases/create -> create /A -> create /A/B -> create /A/B/C -> listDir(kb root) -> listDir(/A) -> listDir(/A/B)` | 每层只返回直接子节点；祖先层级可逐级展开；路径结构稳定 | 已写 |
| D2 | 目录管理员 | 在多级目录最深层导入文件 | `create /A/B/C -> knowledgeItems/import(/A/B/C/file.md) -> listDir(/A/B/C) -> glob(A/**)` | 深层文件能被准确列出和匹配，祖先层路径解析正常 | 已写 |
| D3 | 目录管理员 | 重命名中间层目录并联动整棵子树 | `create /A/B/C -> knowledgeItems/import -> rename B to B2 -> listDir(/A) -> listDir(/A/B2) -> listDir(/A/B2/C) -> readFile old/new -> glob old/new` | 中间层改名后，所有后代路径同步变化；旧路径全失效；新路径全生效 | 已写 |
| D4 | 目录管理员 | 删除中间层目录并删除整棵子树 | `create /A/B/C -> knowledgeItems/import -> delete B -> listDir(/A) -> listDir(/A/B) -> readFile -> knowledgeItems/search` | 删除中间层后，`B` 及其所有后代一起消失 | 已写 |
| D5 | 目录管理员 | 多级目录同级重名冲突 | `create /A/B1 -> create /A/B2 -> rename B2 to B1` | 返回 `KB_DIRECTORY_NAME_CONFLICT`；祖先和后代结构保持原样 | 已写 |
| D6 | 普通使用者 | 多级目录 glob/读取一致 | `create multi-level tree -> knowledgeItems/import at different levels -> glob(pattern) -> readFile` | `glob` 命中的任意路径都能被 `readFile` 读取（需先通过 `fileToMarkdownIndex` 构建）；深层路径无歧义 | 已写 |

## knowledge_base 场景总表

| 编号 | 用户角色 | 用户目标 | 典型调用链 | 核心预期 | 状态 |
| --- | --- | --- | --- | --- | --- |
| 1 | 知识库管理员 | 创建空知识库 | `knowledgeBases/create -> listDir(/)` | 创建后根层级可见；重复创建冲突；非法请求报标准错误 | 已写 |
| 2 | 知识库管理员 | 修改知识库基础信息 | `knowledgeBases/create -> knowledgeBases/update -> listDir(/)` | 修改 `kb_name` 后根目录名称同步变化；旧名称路径失效 | 已写 |
| 3 | 知识库管理员 | 删除知识库 | `knowledgeBases/create -> directories/create -> knowledgeItems/import -> knowledgeBases/delete -> listDir(/) -> readFile -> knowledgeItems/search` | 删除后根层级不可见；文件不可读；内容不可检索 | 已写 |
| 4 | 目录管理员 | 创建单层目录 | `knowledgeBases/create -> directories/create -> listDir(kb root)` | 父层级能看到新目录；重复路径冲突；父目录缺失时报错 | 已写 |
| 5 | 目录管理员 | 创建多层目录树 | `create /A -> create /A/B -> create /A/B/C -> listDir(/A) -> listDir(/A/B) -> glob(A/*)` | 每层只返回直接子节点；`glob` 与目录结构一致 | 已写 |
| 6 | 目录管理员 | 目录改名影响整棵子树 | `create parent -> create child -> knowledgeItems/import -> update child name -> listDir/glob/readFile old&new` | 新路径生效；旧路径失效；子文件随目录路径变化 | 已写 |
| 7 | 目录管理员 | 删除非空目录 | `create dir -> knowledgeItems/import -> directories/delete -> listDir -> glob -> readFile -> knowledgeItems/search` | 整个子树从浏览、读取、检索里一起消失 | 已写 |
| 8 | 目录管理员 | 目录同级重名冲突 | `create /A/B1 -> create /A/B2 -> update B2 to B1 -> listDir(/A)` | 返回 `KB_DIRECTORY_NAME_CONFLICT`；目录树保持不变 | 已写 |
| 9 | 内容管理员 | 导入单文件并构建索引 | `knowledgeBases/create -> directories/create -> knowledgeItems/import -> fileToMarkdownIndex -> listDir -> readFile(markdown) -> downloadFile(original) -> knowledgeItems/search` | 导入后通过 `fileToMarkdownIndex` 构建；接口成功受理后最终可读、可下载、可检索 | 已写 |
| 9A | 内容管理员 | 查询异步构建状态 | `knowledgeItems/import -> fileToMarkdownIndex -> fileBuildStatus` | `fileToMarkdownIndex` 立即返回受理成功；`fileBuildStatus` 返回 `status/currentStep`，构建完成后为 `complete/complete`，并携带 `statusDict/stepDict` | 已写 |
| 9B | 内容管理员 | 构建中重复提交同一文件 | `knowledgeItems/import -> fileToMarkdownIndex(first running) -> fileBuildStatus -> fileToMarkdownIndex(second)` | 首次请求创建 `running` 任务；状态查询返回 `running`；重复提交返回 `resultCode=-1` 和“已有构建任务”错误提示 | 已写 |
| 9C | 内容管理员 | 构建失败后重新触发构建 | `knowledgeItems/import -> fileToMarkdownIndex(fail) -> fileBuildStatus -> fileToMarkdownIndex(retry) -> fileBuildStatus` | 失败后状态查询返回 `failed`；再次触发允许重建；重试成功后状态变为 `complete/complete` | 已写 |
| 10 | 内容管理员 | ~~用真实知识构建结果分步写入单文件~~ | ~~`write-file -> write-index`~~ | ~~`write-file`/`write-index` 路由已移除，分步写入链路不再存在~~ | 已弃用 |
| 11 | 内容管理员 | ~~比较原子导入与分步写入的最终行为~~ | ~~`write-file -> write-index` 对比 `knowledgeItems/import`~~ | ~~`write-file`/`write-index` 路由已移除，无需比较~~ | 已弃用 |
| 12 | 内容管理员 | 路径绑定冲突 | `knowledgeItems/import A:/x.md -> knowledgeItems/import B:/x.md` | 第二次写入失败；原绑定不变 | 已写 |
| 13 | 内容管理员 | 删除单文件 | `knowledgeItems/import -> listDir -> readFile -> knowledgeItems/delete -> listDir -> readFile -> knowledgeItems/search` | 删除后目录不可见、文件不可读、内容不可检索 | 已写 |
| 14 | 内容管理员 | 软删除路径占用 | `knowledgeItems/import -> knowledgeItems/delete -> knowledgeItems/import same path` | 已改为基于路径的模型；验证软删除后重新导入同路径的行为 | 已写 |
| 15 | 普通使用者 | 根目录浏览 | `create multiple kb -> listDir(/)` | 返回所有知识库根节点，名称正确 | 已写 |
| 16 | 普通使用者 | 多层目录浏览 | `create tree -> listDir(root) -> listDir(child) -> listDir(file path)` | 目录返回直接子项；文件路径按约定返回单文件结果 | 已写 |
| 17 | 普通使用者 | glob 模式浏览 | `knowledgeItems/import -> glob(pattern) -> rename/delete -> glob(pattern again)` | 匹配结果与目录结构一致；状态变化后同步变化 | 已写 |
| 18 | 普通使用者 | 读取 markdown 全量内容 | `knowledgeItems/import -> fileToMarkdownIndex -> readFile(full)` | 返回完整 markdown（需先构建）；`reached_eof=true` | 已写 |
| 19 | 普通使用者 | 读取 markdown 行窗口 | `knowledgeItems/import -> fileToMarkdownIndex -> readFile(startLine,endLine)` | 返回指定行范围；`reached_eof` 正确；非法窗口报错；未构建时返回 "file not built" 错误 | 已写 |
| 20 | 普通使用者 | 读取构建后的 markdown / 下载原文件 | `knowledgeItems/import -> fileToMarkdownIndex -> readFile` 读取已构建 markdown；`downloadFile` 获取原始文件 | `readFile` 仅返回已构建的 markdown（未构建时返回 "file not built" 错误）；原始文件通过 `downloadFile` 下载 | 已写 |
| 20A | 普通使用者 | 下载中文文件名的 Markdown 原文件 | `knowledgeItems/import(中文文件名) -> downloadFile` | 返回原始字节流；`Content-Disposition` 对非 ASCII 文件名安全；`Content-Type=text/markdown` | 已写 |
| 20B | 普通使用者 | 下载二进制 PDF 原文件 | `knowledgeItems/import(pdf) -> fileToMarkdownIndex -> downloadFile` | 返回原始 PDF 字节流；`Content-Type=application/pdf`；下载文件名正确 | 已写 |
| 21 | 检索使用者 | 单文件命中检索 | `knowledgeItems/import -> fileToMarkdownIndex -> knowledgeItems/search` | 返回对应 chunk；路径、版本、chunk 编号正确 | 已写 |
| 22 | 检索使用者 | 过滤条件检索 | `knowledgeItems/import multiple files -> fileToMarkdownIndex -> knowledgeItems/search with knCodeList/source/type filters` | 仅返回符合过滤条件的结果 | 已写 |
| 23 | 检索使用者 | 删除后的检索收敛 | `knowledgeItems/import -> fileToMarkdownIndex -> knowledgeItems/search hit -> knowledgeItems/delete -> knowledgeItems/search again` | 已删除内容不再命中 | 已写 |
| 24 | 检索使用者 | 目录改名后的检索路径更新 | `knowledgeItems/import -> fileToMarkdownIndex -> knowledgeItems/search -> directories/update -> knowledgeItems/search again` | 内容仍命中，但 `filePath` 更新为新路径 | 已写 |
| 25 | 跨接口一致性 | 浏览、读取、检索一致 | `knowledgeItems/import -> fileToMarkdownIndex -> listDir -> readFile -> knowledgeItems/search` | 可见文件一定可读（已构建）；搜索结果路径可被读取 | 已写 |
| 26 | 跨接口一致性 | ~~原子导入与分步写入行为一致~~ | ~~`write-file -> write-index` 对比 `knowledgeItems/import`~~ | ~~`write-file`/`write-index` 路由已移除，分步写入链路不再存在~~ | 已弃用 |
| 27 | 跨接口一致性 | 改名或删除后的全局一致性 | `rename/delete -> listDir -> glob -> readFile -> knowledgeItems/search` | 所有读接口观察到的状态一致 | 已写 |
| 28 | 异常与恢复 | 请求参数不合法 | 覆盖缺少必填、空字符串、重复 `chunk_no`、非法 line window 等 | 返回统一请求校验或业务校验错误 | 已写 |
| 29 | 异常与恢复 | 运行时依赖未配置 | 覆盖 KB runtime/fetch runtime/embedding 配置缺失 | 返回 `configuration_error` 风格错误 | 已写 |
| 30 | 异常与恢复 | 构建或落库失败不留下半成功状态 | `knowledgeItems/import failure` 或 `fileToMarkdownIndex failure` | 不留下可见但不可读、可检索但不可读等异常状态 | 已写 |

## 元数据与 DSL 检索场景总表

说明：

- 这一组场景覆盖元数据属性定义、文件元数据增量更新、纯元数据检索、DSL 升级版 chunk/file 检索的端到端调用链。
- 系统字段（`fileName`/`fileType`/`fileSize`/`mimeType`/`filePath`/`createdAt`/`updatedAt`）不需要 `metadataProperties/create`，但其余自定义属性必须先注册再使用。
- `metadata/get` 返回自定义元数据 + 系统字段值；`metadataFields/list` 返回已使用的自定义属性 + 7 个系统字段定义。
- 错误响应统一使用文档化信封：HTTP 200 + `resultCode="-1"` + `resultMsg="..."`（包括 Pydantic 校验失败）。
- 编号与 `tests/knowledge_base/integration/test_metadata_api_integration.py` 的测试函数 1:1 对应。

### 元数据属性定义生命周期

| 编号 | 用户角色 | 用户目标 | 典型调用链 | 核心预期 | 状态 |
| --- | --- | --- | --- | --- | --- |
| M1.a | 元数据管理员 | 创建多个属性后全量列出 | `metadataProperties/create * 3 -> metadataProperties/list` | 三者都出现在结果中 | 已写 |
| M1.b | 元数据管理员 | 按 propertyNameList 过滤 | `create A,B -> list propertyNameList=[A]` | 仅返回 A | 已写 |
| M1.c | 元数据管理员 | propertyNameList 含未知名 | `list propertyNameList=[ghost]` | 返回 `data=[]`，不报错 | 已写 |
| M1.d | 元数据管理员 | 重复创建冲突 | `create A -> create A` | 第二次返回 `resultCode=-1` `"already exists"` | 已写 |
| M1.e | 元数据管理员 | 系统字段同名拒绝 | `create propertyName=fileName` 等 | `resultCode=-1` `"conflicts with system field"` | 已写 |
| M1.f | 元数据管理员 | propertyName 边界 | `create propertyName=""` 或 129 字符 | 文档化信封 | 已写 |
| M1.g | 元数据管理员 | 非法 valueType | `create valueType=int/json/STRING` | 文档化信封 | 已写 |
| M1.h | 元数据管理员 | 删除不存在属性 | `metadataProperties/delete propertyName=ghost` | `resultCode=-1` `"not found"` | 已写 |
| M1.i | 元数据管理员 | 删除无引用属性 | `create -> delete -> list` | 删除成功；list 不再返回 | 已写 |
| M2.a | 元数据管理员 | 批量创建多项成功 | `batchCreate [A,B]` | 全部入库 | 已写 |
| M2.b | 元数据管理员 | 批量含冲突项整批回滚 | `create A -> batchCreate [B,A]` | 全失败；B 不留下 | 已写 |
| M2.c | 元数据管理员 | 批量含非法 valueType 整批回滚 | `batchCreate [ok,bad]` | 文档化信封；ok 不留下 | 已写 |
| M2.d | 元数据管理员 | 批量 propertyList 为空 | `batchCreate {propertyList:[]}` | 文档化信封 | 已写 |
| M3.a | 元数据管理员 | 被引用时拒绝删除 | `create P -> metadata/update set P -> metadataProperties/delete P` | `resultCode=-1` `"still referenced"` | 已写 |
| M3.b | 元数据管理员 | 释放引用后允许删除 | 续 M3.a:`metadata/update unset P -> delete P` | 删除成功 | 已写 |
| M3.c | 元数据管理员 | clear 后仍计为引用 | `set list -> clear -> delete` | 仍拒删 | 已写 |

### 文件元数据增量更新

| 编号 | 用户角色 | 用户目标 | 典型调用链 | 核心预期 | 状态 |
| --- | --- | --- | --- | --- | --- |
| M4.a | 内容管理员 | 五种类型 set+get 回读 | 分别 set string/number/boolean/datetime/stringList → `metadata/get` | `valueType` 与 `value` 都正确 | 已写 |
| M4.b | 内容管理员 | 未注册属性写入被拒 | `metadata/update set undefined` | `resultCode=-1` `"not defined"` | 已写 |
| M4.c | 内容管理员 | 非法 operation 字面量 | `operation=upsert` | 文档化信封 | 已写 |
| M4.d | 内容管理员 | 同请求多 op 同属性按序生效 | 一次请求里 `[set v1, set v2]` | 最终为 v2 | 已写 |
| M4.e | 内容管理员 | unset 不存在属性幂等 | 文件无该属性时 `unset` | 成功；`metadata/get` 仍无该属性 | 已写 |
| M4.f | 内容管理员 | 错误 KB / 文件路径 | 未知 knCode / filePath | `resultCode=-1` `"knowledge base not found"` / `"file not found"` | 已写 |
| M4.g | 内容管理员 | metadata/get 未知 KB | `metadata/get knCode=ghost` | `resultCode=-1` `"knowledge base not found"` | 已写 |
| M4.h | 内容管理员 | metadata/get 未知文件 | `metadata/get filePath=/never.md` | `resultCode=-1` `"file not found"` | 已写 |
| M4.i | 内容管理员 | metadata/get 返回系统字段值 | `import file -> metadata/get` | `metadata` 包含 `fileName`/`fileType`/`fileSize`/`mimeType`/`createdAt`/`updatedAt`/`filePath` 七个系统字段，`valueType` 与 `value` 正确 | 已写 |
| M4.j | 内容管理员 | metadata/get metadataFieldList 过滤系统字段 | `import file -> metadata/get metadataFieldList=[fileName,fileSize]` | 仅返回命中的系统字段 | 已写 |
| M5.a | 内容管理员 | append 去重 | `set [a,b] -> append [b,c]` | `[a,b,c]` | 已写 |
| M5.b | 内容管理员 | remove 容忍不存在元素 | `set [a] -> remove [x,y]` | `[a]`，不报错 | 已写 |
| M5.c | 内容管理员 | set 整值覆盖列表 | `set [a,b] -> set [x]` | `[x]` | 已写 |
| M5.d | 内容管理员 | clear 后保留 valueType | `set [a,b] -> clear -> get` | `valueType=stringList, value=[]` | 已写 |
| M5.e | 内容管理员 | 列表/标量 op 类型不匹配 | string 字段 `append`、number 字段 `append` 等 | `resultCode=-1` `"not allowed"` | 已写 |
| M6.a | 内容管理员 | front matter 自动注入 | `import md(--- prop: active ---)` | metadata 自动写入 | 已写 |
| M6.b | 内容管理员 | front matter 未注册字段 | `import md(--- ghost: 1 ---)` | `resultCode=-1` `"not a defined metadata property"` | 已写 |
| M6.c | 内容管理员 | front matter 多类型 | string + number + stringList 一起 | 全部正确 | 已写 |
| M6.d | 内容管理员 | 无 front matter 仍可导入 | `import md(无 --- 块)` | 导入成功；metadata 为空 | 已写 |
| M6.e | 内容管理员 | front matter 格式错容错 | 缺收尾 ---、YAML 语法错、顶层非 dict | 导入成功；metadata 为空（fail-soft） | 已写 |
| M6.f | 内容管理员 | front matter 的 stringList 取 null | `import md(--- tags: null ---)` | 导入成功；`metadata/get` 返回 `valueType=stringList, value=null` | 已写 |

### 删除联动

| 编号 | 用户角色 | 用户目标 | 典型调用链 | 核心预期 | 状态 |
| --- | --- | --- | --- | --- | --- |
| M7.a | 内容管理员 | 删除文件清理元数据 | `metadata/update -> knowledgeItems/delete -> metadataSearch / metadata/get` | metadataSearch 不命中；metadata/get 报 file not found | 已写 |
| M7.b | 目录管理员 | 删除目录联动 | `import 多个 -> directories/delete -> metadataSearch / metadataFields/list` | 子树文件全部从读接口消失 | 已写 |
| M7.c | 知识库管理员 | 删除知识库联动 | `knowledgeBases/delete -> metadataFields/list` | KB 级 KB not found，元数据全部失效 | 已写 |
| M7.d | 知识库管理员 | metadataFields/list knCodeList 必填非空 | 不传 / `knCodeList=[]` | 文档化信封 | 已写 |
| M7.e | 知识库管理员 | metadataFields/list 多 KB 合并 | `knCodeList=[A,B]`,各自用过 prop_x/prop_y | 返回 prop_x 与 prop_y 的并集 | 已写 |
| M7.f | 知识库管理员 | metadataFields/list 单 KB scope 隔离 | `knCodeList=[A]`,A 用过 prop_x、B 用过 prop_y | 仅返 prop_x | 已写 |
| M7.g | 知识库管理员 | metadataFields/list 始终返回系统字段定义 | `knowledgeBases/create -> metadataFields/list` | 7 个系统字段（`fileName`/`fileType`/`fileSize`/`mimeType`/`createdAt`/`updatedAt`/`filePath`）始终出现在结果末尾，含 `propertyName`/`valueType`/`description`，即使 KB 无任何用户自定义属性 | 已写 |

### metadataSearch 接口约束

| 编号 | 用户角色 | 用户目标 | 典型调用链 | 核心预期 | 状态 |
| --- | --- | --- | --- | --- | --- |
| M8.a | DSL 调用方 | where 必填 | 不传 where | 文档化信封 | 已写 |
| M8.b | DSL 调用方 | where 为空对象 | `where={}` | DSL_VALIDATION_ERROR / INVALID_BOOLEAN_NODE | 已写 |
| M8.c | DSL 调用方 | topK 默认 500 | 不传 topK | 请求被接受 | 已写 |
| M8.d | DSL 调用方 | topK 上限 10000 | `topK=10001` 拒绝；`topK=10000` 通过 | 文档化信封 / 200 | 已写 |
| M8.e | DSL 调用方 | topK 0 / 负数 | `topK=0/-1` | 文档化信封 | 已写 |
| M8.f | DSL 调用方 | knCodeList 缩范围 | 两 KB 命中，knCodeList=[A] | 仅返 A | 已写 |
| M8.g | DSL 调用方 | knCodeList 含未知 KB | `knCodeList=[ghost]` | `resultCode=-1` `"knowledge base not found"` | 已写 |
| M8.h | DSL 调用方 | metadataFieldList 返回控制 | `metadataFieldList=[keep]` | 仅返 keep | 已写 |
| M8.i | DSL 调用方 | knCodeList 必填非空 | 不传 / `knCodeList=[]` | 文档化信封 | 已写 |

### DSL 算子矩阵

| 编号 | 用户角色 | 用户目标 | 典型调用链 | 核心预期 | 状态 |
| --- | --- | --- | --- | --- | --- |
| M9.eq | DSL 调用方 | eq | `eq status active` | 命中 status=active 文件 | 已写 |
| M9.ne | DSL 调用方 | ne | `ne status active` | 命中 status≠active 且属性存在的文件 | 已写 |
| M9.in | DSL 调用方 | in | `in status [active,pending]` | 命中其一 | 已写 |
| M9.contains | DSL 调用方 | contains | `contains tags contract` | 命中 tags 含 contract 的文件 | 已写 |
| M9.exists | DSL 调用方 | exists | `exists archived` | 命中所有设置过 archived 的文件 | 已写 |
| M9.gt | DSL 调用方 | gt number | `gt priority 5` | 命中 >5 | 已写 |
| M9.gte | DSL 调用方 | gte number | `gte priority 5` | 含等号 | 已写 |
| M9.lt | DSL 调用方 | lt number | `lt priority 5` | 命中 <5 | 已写 |
| M9.lte | DSL 调用方 | lte number | `lte priority 5` | 含等号 | 已写 |
| M9.gt-dt | DSL 调用方 | gt datetime | `gt publishedAt 2026-02-01...Z` | 时间窗口命中 | 已写 |
| M9.prefix | DSL 调用方 | prefix string | `prefix status "act"` | 命中 status 以 "act" 开头的文件 | 待补 |
| M9.wildcard | DSL 调用方 | wildcard string | `wildcard status "act*"` | 命中 status 匹配通配符的文件 | 待补 |
| M9.and | DSL 调用方 | and 平铺 | `and [eq, contains]` | 取交集 | 已写 |
| M9.or | DSL 调用方 | or 平铺 | `or [eq, eq]` | 取并集 | 已写 |
| M9.not | DSL 调用方 | not 包叶子 | `not eq status archived` | 排除 archived 文件 | 已写 |
| M9.nest1 | DSL 调用方 | and(or, leaf) 二层 | active/pending 且 priority>3 | 交集 | 已写 |
| M9.nest2 | DSL 调用方 | or(not, leaf) 二层 | not exists archived 或 status=active | 并集 | 已写 |
| M9.nest3 | DSL 调用方 | 三层嵌套（depth=3 边界） | `and[or[and[eq,contains]]]` | 通过；命中 active+hr | 已写 |
| M9.demor | DSL 调用方 | 德摩根等价 | `not(or[A,B]) ≡ and[not A, not B]` | 两侧命中集合相同 | 已写 |
| M9.prefix-fn | DSL 调用方 | prefix 系统字段 fileName | `prefix fileName "F"` | 命中 fileName 以 "F" 开头的文件 | 待补 |
| M9.wildcard-fn | DSL 调用方 | wildcard 系统字段 fileName | `wildcard fileName "F?.md"` | 命中 F1.md..F6.md 不命中 F5.pdf | 待补 |

### DSL 校验错误

| 编号 | 用户角色 | 用户目标 | 典型调用链 | 核心预期 | 状态 |
| --- | --- | --- | --- | --- | --- |
| M10.a | DSL 调用方 | string 字段传 number | `eq status 1` | INVALID_FIELD_VALUE_TYPE | 已写 |
| M10.b | DSL 调用方 | number 字段传 string | `eq priority "5"` | INVALID_FIELD_VALUE_TYPE | 已写 |
| M10.c | DSL 调用方 | number 字段传 bool | `eq priority true` | INVALID_FIELD_VALUE_TYPE | 已写 |
| M10.d | DSL 调用方 | datetime 非 ISO8601 | `gt publishedAt "yesterday"` | INVALID_FIELD_VALUE_TYPE | 已写 |
| M10.e | DSL 调用方 | exists 携带 value | `exists{... value:"x"}` | INVALID_FIELD_VALUE_TYPE | 已写 |
| M10.f | DSL 调用方 | in 用于 stringList | `in tags ["hr"]` | INVALID_FIELD_VALUE_TYPE | 已写 |
| M10.g | DSL 调用方 | contains 用于非 stringList | `contains status "active"` | INVALID_FIELD_VALUE_TYPE | 已写 |
| M10.h | DSL 调用方 | gt 用于 string | `gt status "active"` | INVALID_FIELD_VALUE_TYPE | 已写 |
| M10.prefix-ns | DSL 调用方 | prefix 用于非 string 字段 | `prefix priority "1"` | INVALID_FIELD_VALUE_TYPE | 待补 |
| M10.wildcard-ns | DSL 调用方 | wildcard 用于非 string 字段 | `wildcard priority "1*"` | INVALID_FIELD_VALUE_TYPE | 待补 |
| M10.i | DSL 调用方 | in.value 空数组 | `in status []` | INVALID_FIELD_VALUE_TYPE | 已写 |
| M10.j | DSL 调用方 | in.value 数组项类型不一致 | `in priority [1,"two"]` | INVALID_FIELD_VALUE_TYPE | 已写 |
| M10.k | DSL 调用方 | 节点对象多于一个 key | `{eq:..., ne:...}` | INVALID_BOOLEAN_NODE | 已写 |
| M10.l | DSL 调用方 | and 操作数空数组 | `{and:[]}` | INVALID_BOOLEAN_NODE | 已写 |
| M10.m | DSL 调用方 | not 操作数为数组 | `{not:[...]}` | INVALID_BOOLEAN_NODE | 已写 |
| M10.n | DSL 调用方 | 未知算子 | `{between: ...}` | UNSUPPORTED_OPERATOR | 已写 |
| M10.o | DSL 调用方 | 未知 fieldName | `{eq:{fieldName:'ghost', value:'x'}}` | UNKNOWN_FIELD | 已写 |
| M11.a | DSL 调用方 | 嵌套深度 4 | 四层嵌套布尔 | TOO_DEEP_BOOLEAN_NESTING | 已写 |
| M11.b | DSL 调用方 | 叶子条件 13 | `and: 13 个 leaf` | TOO_MANY_CONDITIONS | 已写 |
| M11.c | DSL 调用方 | 多错误同时返回 | unknown_field + 类型错 | errorList ≥ 2 条 | 已写 |

### 系统字段进 DSL（metadataSearch）

| 编号 | 用户角色 | 用户目标 | 典型调用链 | 核心预期 | 状态 |
| --- | --- | --- | --- | --- | --- |
| M12.a | DSL 调用方 | in fileType | `in fileType ["md","pdf"]` | 命中扩展名匹配文件 | 已写 |
| M12.b | DSL 调用方 | eq fileName | `eq fileName "note.txt"` | 精确命中 | 已写 |
| M12.c | DSL 调用方 | gt fileSize | `gt fileSize 1000` | 命中大文件 | 已写 |
| M12.d | DSL 调用方 | gt createdAt | `gt createdAt ISO8601` | 时间窗口命中 | 已写 |
| M12.e | DSL 调用方 | contains 用于系统字段 | `contains fileType "md"` | INVALID_FIELD_VALUE_TYPE | 已写 |
| M12.f | DSL 调用方 | metadataSearch 系统+自定义混合 | `and: [eq custom status active, in fileType ["md"]]` | 仅 .md 且 status=active 的文件命中 | 已写 |
| M12.fp-eq | DSL 调用方 | eq filePath 精确匹配 | `eq filePath "/dsl/F1.md"` | 仅命中 `/dsl/F1.md` | 已写 |
| M12.fp-prefix | DSL 调用方 | prefix filePath 目录过滤 | `prefix filePath "/dsl/"` | 命中 `/dsl/` 下所有文件含子目录，不含 `/other/` | 已写 |
| M12.fp-wildcard | DSL 调用方 | wildcard filePath 单级 | `wildcard filePath "/dsl/F?.md"` | 命中 F1–F6.md，不含 F5.pdf 和 nested | 已写 |
| M12.fp-wildcard-pen | DSL 调用方 | wildcard filePath `*` 穿透 `/` | `wildcard filePath "/dsl/F?.*"` | 命中 F1–F6.md + F5.pdf + nested.txt | 已写 |
| M12.fp-files-only | DSL 调用方 | filePath 仅返回 FILE | `prefix filePath "/"` | 仅返回 FILE 条目，不含 DIRECTORY | 已写 |
| M12.fp-no-match | DSL 调用方 | wildcard filePath 无命中 | `wildcard filePath "/dsl/X*"` | 空集 | 已写 |
| M12.fp-create | DSL 调用方 | virtual_path 创建时赋值 | `import file -> eq filePath` | 创建文件后 filePath 精确可查 | 已写 |
| M12.fp-rename | DSL 调用方 | virtual_path 目录改名联动 | `rename dir -> prefix filePath new/old` | 子树文件迁移到新路径，旧路径空集 | 已写 |


### 升级版 chunk 检索 / 文件级检索 / 兼容字段

| 编号 | 用户角色 | 用户目标 | 典型调用链 | 核心预期 | 状态 |
| --- | --- | --- | --- | --- | --- |
| M13.a | DSL 调用方 | 三 mode × where 都生效 | `search` 三种 mode + where eq status active | 命中目标文件 | 已写 |
| M13.b | DSL 调用方 | 不传 metadataFieldList 不返 metadata | `search`（无 metadataFieldList） | metadata=None | 已写 |
| M13.c | DSL 调用方 | metadataFieldList 限制返回字段 | `search metadataFieldList=[keep]` | 仅含 keep | 已写 |
| M13.d | DSL 调用方 | where 圈定为空 | `search where eq status archived` | data=[] | 已写 |
| M13.e | DSL 调用方 | topK 边界 | `search topK=0/-1/缺失` | 文档化信封 | 已写 |
| M13.f | DSL 调用方 | system field in fileType（chunk） | `search where in fileType ["md"]` | 仅 md 文件命中 | 已写 |
| M13.g | DSL 调用方 | custom + system 合取（chunk） | `search where and:[custom, gt fileSize]` | 两端都满足才命中 | 已写 |
| M13.h | DSL 调用方 | where 进入召回 SQL（前过滤证明） | top1=A → 加 `where 排除 A` → top1=B | B 上位证明 where 是前过滤而非后过滤 | 已写 |
| M14.a | DSL 调用方 | fileTypeList 单独使用 | `search fileTypeList=["md"]` | md 命中、txt 不中 | 已写 |
| M14.b | DSL 调用方 | fileTypeList 与 where 合取 | `fileTypeList=["md"]` + `where in fileType ["txt"]` | 交集为空 | 已写 |
| M15.a | DSL 调用方 | searchFile 同 filePath 不重复 | 单文件 ≥2 chunk 命中 → searchFile | 同 filePath ==1 次（前置确认 chunk 多命中） | 已写 |
| M15.b | DSL 调用方 | searchFile + where + metadataFieldList | searchFile + active 过滤 + metadata 返回 | 命中 + metadata.value=active | 已写 |
| M15.c | DSL 调用方 | searchFile knCodeList 必填非空 | 不传 / `knCodeList=[]` | 文档化信封 | 已写 |
| M15.d | DSL 调用方 | system field in fileType（file） | `searchFile where in fileType ["md","txt"]` | 文件级聚合后扩展名过滤生效 | 已写 |
| M15.e | DSL 调用方 | system field gt createdAt（file） | `searchFile where gt createdAt past/future` | 时间窗口命中/不中 | 已写 |
| M15.f | DSL 调用方 | searchFile 系统+自定义混合 | `and: [eq custom status active, in fileType ["md","txt"]]`,收紧 fileType 后取空 | 自定义+系统两侧都生效 | 已写 |

### 跨接口一致 / 软删保护

| 编号 | 用户角色 | 用户目标 | 典型调用链 | 核心预期 | 状态 |
| --- | --- | --- | --- | --- | --- |
| M16.a | 跨接口一致性 | update→search→get 三向一致 | set/unset 后三向比对 | 三方观察一致 | 已写 |
| M16.b | 跨接口一致性 | metadataFields/list 与值同步 | set 后含；unset 后无 | 同步反映 | 已写 |
| M16.c | 跨接口一致性 | clear 后字段仍出现在 fields/list | set→clear→list | 仍含该 propertyName | 已写 |
| M17.a | DSL 调用方 | 软删文件不在 metadataSearch | `update -> delete -> metadataSearch` | 不命中已删文件 | 已写 |
| M17.b | DSL 调用方 | 软删文件不在 search/searchFile | `delete -> search/searchFile` | 不命中 | 已写 |
| M17.c | DSL 调用方 | 重新导入同路径仅命中新文件 | `delete -> import same path -> metadataSearch` | 旧值 0 命中、新值精确 1 命中 | 已写 |

## knowledge_build 场景总表

> **已弃用：** `knowledge_build` 独立路由（`file-to-markdown`、`build-markdown-index`、`file-to-markdown-index`）已全部移除。构建功能已整合到 `/api/v1/fileToMarkdownIndex`，作为 `knowledge_base` 模块的一部分。以下场景仅作历史参考。

| 编号 | 用户角色 | 用户目标 | 典型调用链 | 核心预期 | 状态 |
| --- | --- | --- | --- | --- | --- |
| A | 构建调用方 | ~~解析单个文件为 markdown~~ | ~~`file-to-markdown`~~ | ~~路由已移除~~ | 已弃用 |
| B | 构建调用方 | ~~从 markdown 构建 chunks~~ | ~~`build-markdown-index`~~ | ~~路由已移除~~ | 已弃用 |
| C | 构建调用方 | ~~一步式与两步式构建结果一致~~ | ~~`file-to-markdown -> build-markdown-index` 对比 `file-to-markdown-index`~~ | ~~路由已移除~~ | 已弃用 |
| D | 构建调用方 | ~~组合接口失败时正确短路~~ | ~~`file-to-markdown-index`~~ | ~~路由已移除~~ | 已弃用 |
| E | 构建调用方 | ~~构建链路异常可预测~~ | ~~覆盖不支持文件类型、非法 base64、空 markdown、未配置、embedding 异常~~ | ~~路由已移除~~ | 已弃用 |

## 当前已落测试文件

| 文件 | 覆盖重点 | 状态 |
| --- | --- | --- |
| `tests/knowledge_build/integration/test_api_integration.py` | ~~`knowledge_build` 三接口正常/异常与组合链路等价性~~ | 已弃用（`knowledge_build` 独立路由已移除） |
| `tests/knowledge_base/integration/test_kb_api_stateful_integration.py` | 混合导入构建（`knowledgeItems/import` + `fileToMarkdownIndex`）、知识库改名、单文件/目录删除、多级目录改名删除、读取窗口校验、`downloadFile` 的中文文件名/二进制文件下载、真实搜索链路与失败保护 | 有效 |
| `tests/knowledge_base/integration/test_metadata_api_integration.py` | M1–M17 全场景:属性 CRUD/批量原子性/引用计数;文件元数据五类型 set/list 操作矩阵;`metadata/get` 错路径(unknown KB/file);YAML front matter(auto/拒绝/缺失/格式错容错);删除三档级联;`metadataFields/list`(KB 必填/多 KB 合并/单 KB 隔离);metadataSearch 接口约束(where 必填/topK 边界/KB scope/字段裁剪/knCodeList 必填);DSL 算子矩阵 + 三层布尔嵌套 + 德摩根;DSL 类型/结构/复杂度错误矩阵;系统字段(metadataSearch 单系统/混合 + chunk + searchFile 单系统/混合);search 升级版(三 mode/metadataFieldList/where 短路/前过滤证明);fileTypeList 兼容;searchFile(多 chunk 去重/where/系统字段/knCodeList 必填);跨接口一致;软删保护 | 有效 |

## 下一轮优先补充建议

| 优先级 | 场景 | 原因 |
| --- | --- | --- |
| P1 | `readFile` 未构建文件错误覆盖 | `readFile` 现在要求文件已通过 `fileToMarkdownIndex` 构建，需验证未构建时返回 "file not built" 错误 |
| P1 | 搜索过滤组合扩展 | 当前已覆盖基础多 `knCodeList`/source/type 组合，后续可继续补更复杂组合 |
| P1 | 配置异常覆盖面扩展 | 当前已覆盖 `knowledgeBases/create`、`listDir`、`readFile`、`knowledgeItems/search`，后续可继续补更多接口 |
| P1 | 清理弃用测试代码 | `test_api_integration.py`（knowledge_build）及场景 10/11/26 对应的测试代码需清理或移除 |
| P2 | `fileToMarkdownIndex` 构建失败保护扩展 | 已覆盖失败状态落库与失败后重试，后续可继续补充切片失败、向量化失败等更细分场景 |
| P2 | 生命周期冲突扩展 | 当前已覆盖路径绑定、软删除复用，后续可继续补更多版本化冲突 |
| P2 | 响应信封格式验证 | 验证所有接口统一使用 `resultCode`/`resultMsg`/`resultObject` 信封格式 |
