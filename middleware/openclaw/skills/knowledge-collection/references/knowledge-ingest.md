# Knowledge-base ingest

采集编排器 `knowledge-collection` 拥有入库编排与确认边界；`by-knowledge-manager` 是底层入库执行器。通过 `knowledge-collection` 内的
`scripts/knowledge-collection-ingest.mjs` 调用它，不得把入库所有权移回 `bycli`。

## 调用边界

- 只有用户在后处理选择中明确选择 `入库` 后，才可运行入库命令；不得先做通用上传再询问用户。
- 先用 `list-kb` 发现可选知识库。目标有歧义时不得静默选择：要求用户明确提供目标
  `--knowledge-base-resource-id`，或展示候选并让用户确认目标。
- `ingest` 与 `upload-doc` 执行前，都必须展示解析后的目标目录并获得用户明确确认；脚本采用的
  默认 `/` 也必须展示，不得把缺省目录视为用户已经确认。
- 仅入库用户选中的范围，包括已确认的条目、Markdown 或文件；不得扩大到同一目录或采集批次的其他产物。
- 入库与知识整理互斥；同一批结果执行 `ingest` 或 `upload-doc` 后，不得再交给知识整理。

## 命令路由

脚本路径均相对 `knowledge-collection` Skill 根目录：

`node scripts/knowledge-collection-ingest.mjs <command> ...`

- `list-kb`：发现个人知识库候选，供用户选择目标。
- `normalize`：在需要时规范化规范的 `collection-result.json`（使用
  `--collection-result-file`）或旧输入。旧参数 `--bycli-json-file`、`--bycli-json` 仅作只读兼容；
  新产物仍写规范格式。
- `ingest`：将用户选中的 Markdown 文件、Markdown 目录或规范化采集结果交给
  `by-knowledge-manager` 执行 upload/build；知识库目标使用 `--knowledge-base-resource-id`，也兼容
  `--knowledge-base-id`，目录使用 `--directory-path`；这些值必须先按上方边界获得用户确认。
- `upload-doc`：仅在用户选中受支持的文档时直传。脚本支持
  `pdf/docx/pptx/xlsx/csv/txt/md`；知识库目标必须使用 `--knowledge-base-resource-id`，目录使用
  `--directory-path`，并且必须先按上方边界获得用户确认。

具体参数以 `node scripts/knowledge-collection-ingest.mjs --help` 为准。命令和示例中只使用资源 ID、
目录与本地文件路径等非敏感占位值。
