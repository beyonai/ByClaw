# 项目云盘知识采集

`cloud-knowledge` 支持单源 `enterprise search`/`metadata-search`，也支持 knowledge-collection V2 的 `unified-search` 与随后可恢复的 `unified-materialize`。单源采集前必须在 `init` 中使用 `--source-scope '["cloud-knowledge"]'` 和 `--cloud-discovery-scope` 固定用户授权的资源 ID 与目录前缀；统一搜索默认同时启用公共互联网和云盘。

搜索阶段强制 metadata-only，只调用项目云盘 Skill 自带的 Python CLI `search-file`，不读取正文。候选必须携带 `resourceId`、`filePath`、`fileType`、`fileSize` 和 `sourceUrl`，并在 session metadata 与恢复 projection 之间完整保留。云盘不支持 `search-all`、单文件 resource 或目录全量 materialization。

物化阶段必须复用同一个会话目录，并从持久化候选恢复 `resourceId` 与 `filePath`；下载输出使用 adapter 生成的会话内安全文件名，不能把远端文件名作为本地路径。所有远端路径都要进行 POSIX 段校验和授权集复核。Markdown、文本和可转换办公文档进入会话根级 `sanitized/items/`，正文可读非空时登记 `full-text`。

认证失败、无效响应和来源失败分别使用稳定终态 reason code `AUTH_REQUIRED`、`INVALID_RESPONSE`、`SOURCE_FAILED`。条目失败原因只保存脱敏、截断后的摘要；不得持久化凭据、完整 stdout/stderr 或后端响应正文。
