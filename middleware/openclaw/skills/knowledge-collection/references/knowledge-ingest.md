# Knowledge-base ingest

采集编排器 `knowledge-collection` 拥有入库编排与确认边界；`by-knowledge-manager` 是底层入库执行器。通过 `knowledge-collection` 内的
`scripts/ingest.mjs` 调用它，不得把入库所有权移回 `bycli`。

## 调用边界

- 只有用户在后处理选择中明确选择 `入库` 后，才可运行入库命令；不得先做通用上传再询问用户。
- 先用 `list-kb` 发现可选知识库。目标有歧义时不得静默选择：要求用户明确提供目标
  `--knowledge-base-resource-id`，或展示候选并让用户确认目标。
- `ingest` 与 `upload-doc` 执行前，都必须展示解析后的目标目录并获得用户明确确认；脚本采用的
  默认目录也必须展示，不得把缺省目录视为用户已经确认。真实写入时必须把已经确认的目标通过
  `--confirmed-knowledge-base-resource-id` 与 `--confirmed-directory-path` 传给脚本，且确认值必须与解析后的
  知识库资源 ID 和目录完全一致；`--dry-run` 只展示所需确认值，不执行写入。
- 未显式给出 `--directory-path` 时，默认目录取自会话目录末段的运行时间戳，即 `/<YYYYMMDD_HHMMSS>/`
  （如 `/20260728_211755/`），使同一批采集产物落在同一个知识库目录下、与会话目录一一对应。时间戳来自
  `--session-dir`（或 `--output-dir`）的路径片段而非当前时间：确认值必须与解析结果完全相等，现取时间戳
  两次不会一致。无法从路径推导出时间戳时回退到根目录 `/`。默认值由脚本解析，先跑 `--dry-run` 读取
  `confirmation.requiredArguments` 即可拿到该次要回传的确认值，不要自行拼接时间戳；默认 `/` 也必须展示并确认。
- 处理当前采集批次时，`ingest` 之前必须先按 [post-processing.md](post-processing.md) 改写选中正文里的 `images/`
  相对链接；相对链接在知识库侧无法解析。入库必须使用持久化模式：目标确认后先用 `upload-images` 把图片上传到
  同一知识库同一目录，把返回的 `linkMap` 写入会话 `.post-processing-inputs/`，再用
  `rewrite-image-links --link-map-file` 改写，最后才 `ingest`。不得使用会话空间模式（`--resource-id`）——
  完整成功后 cleanup 会删除整个会话目录，知识库里的图片链接会全部失效。该步骤同样适用于知识整理与外部消费，
  不是入库专属。命令幂等，已改写过的会话可安全重跑。独立 Markdown 文件与 `upload-doc` 不涉及会话空间图片，
  不需要这一步。
- 仅入库用户选中的范围，包括已确认的条目、Markdown 或文件；不得扩大到同一目录或采集批次的其他产物。
- 入库与知识整理在同一次后处理运行中互斥；不得在一次运行内把 `ingest` 或 `upload-doc` 自动串联到知识整理。
  用户后续明确发起知识整理时创建新的 run，不复用入库成功状态。

通过 `knowledge-collection` 处理当前采集批次时，选中正文只能来自 `sanitized/items/*.md`。缺失净化正文时先按
[post-processing.md](post-processing.md) 通过原始执行器重新净化或补采；仍缺失则跳过并告知用户。不得使用 `markdown/*.md`、
任意 Markdown 目录、stdin 或旧 JSON 绕过该规则。脚本保留这些参数仅用于独立文件与旧输入兼容。

入库结果必须逐篇映射回 inventory `itemId`。只有文章上传成功且对应 build 请求被接受时才记为 success；不等待异步
索引完成。批量失败且无法确认逐篇结果时记为 unknown，不得清理对应工作副本。结果通过后处理状态脚本写入 run。
调用脚本时可按 Markdown 输入顺序重复传入 `--item-id <inventory-item-id>`；返回的 `itemResults` 是唯一允许回写
`run`(旧名 `record-run`)的逐篇结果。只有输入文件名在批次内唯一、上传结果能唯一对应该文件名，并且 build 精确引用该上传结果路径时，
才可机械映射为 success；任一条件不满足必须返回 `unknown`，不得用模糊文件名匹配猜测 success。`ingest` 将该数组同时放在
顶层 `itemResults` 和知识库上传结果中，`upload-doc` 直接在顶层返回。

## 命令路由

脚本路径均相对 `knowledge-collection` Skill 根目录。两个入口等价，平台命令不要求采集会话：

`node scripts/ingest.mjs <command> ...`
`node scripts/knowledge-collection.mjs <command> ...`

- `list-kb`：发现个人知识库候选，供用户选择目标。
- `normalize`：在需要时规范化规范的 `collection-result.json`（使用
  `--collection-result-file`）或旧输入。旧参数 `--bycli-json-file`、`--bycli-json` 仅作只读兼容；
  新产物仍写规范格式。规范 collection result 的 `items: []` 会返回 `needsMaterialization: true`，不再被当作损坏 JSON。
- `ingest`：将用户选中的 Markdown 文件、Markdown 目录或规范化采集结果交给
  `by-knowledge-manager` 执行 upload/build；知识库目标使用 `--knowledge-base-resource-id`，也兼容
  `--knowledge-base-id`（脚本会通过 `list-kb` 将旧数据集 ID 解析为实际资源 ID），目录使用
  `--directory-path`；这些值必须先按上方边界获得用户确认，并用对应的
  `--confirmed-knowledge-base-resource-id` 与 `--confirmed-directory-path` 绑定本次写入。
- 使用 `--check-conflicts` 返回 `confirm-overwrite` 时，脚本会保留本次 Markdown，并在 `continuation` 中
  返回恢复所需路径。用户明确确认全部 `overwritePaths` 后，以保留的 `--markdown-file` 重试，并逐个传入
  `--confirmed-overwrite-path`；脚本会重新检查冲突集合，完全一致时才调用覆盖接口。恢复调用不得重新传入
  已经成功上传的图片、音频或视频。
- `upload-images`：把选中正文里的本地图片上传到已确认的知识库与目录，只 upload 不 build，返回
  `linkMap`（正文相对链接 → 知识库下载 URL）供 `rewrite-image-links --link-map-file` 使用。知识库目标使用
  `--knowledge-base-resource-id`，目录使用 `--directory-path`，必须与入库目标一致；`--base-url` 可选，
  用于消费方无法解析站内相对路径时追加 origin 前缀。
- `upload-doc`：仅在用户选中受支持的文档时直传。脚本支持
  `pdf/docx/pptx/xlsx/csv/txt/md`；知识库目标必须使用 `--knowledge-base-resource-id`，目录使用
  `--directory-path`，并且必须先按上方边界获得用户确认，再传入对应的
  `--confirmed-knowledge-base-resource-id` 与 `--confirmed-directory-path`。批量文档同样可重复传入
  `--item-id`，返回 `itemResults`；未能证明上传和 build 对应关系的文档只能记为 `unknown`。

具体参数以 `node scripts/ingest.mjs --help` 为准。命令和示例中只使用资源 ID、
目录与本地文件路径等非敏感占位值。后端请求受 `KNOWLEDGE_COLLECTION_BACKEND_TIMEOUT_MS` 截止时间约束；超时或
无法证明逐篇结果时必须保守保留工作副本并记为 `unknown`。
