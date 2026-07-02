# Zread Wiki Modes

Zread 阶段用于把已经拉取并索引的仓库生成 Wiki，或读取已生成的 Wiki 页面。

## 生成前检查

先调用：

```json
{
  "repositoryUrl": "https://github.com/org/repo.git",
  "mode": "wiki_status"
}
```

关注：

- `zread.installed`
- `zread.modelSource`
- `zread.modelConfigured`
- `zread.modelConfigError`
- `zread.hasDraft`
- `zread.hasCurrentWiki`

服务器部署下，byclaw-wiki 会优先从 Redis 的平台默认 LLM 自动生成 Zread
配置；Redis 不可用时，会使用插件配置里的 `zreadLlmProvider`、
`zreadLlmModel`、`zreadLlmBaseUrl`、`zreadLlmApiKeyEnv` 或
`zreadLlmApiKey` 兜底。若 `modelConfigError` 非空，不要让业务用户手动填写
API Key；应提示运维检查 byclaw-wiki plugin config 中的 `redisHost`、
`redisPort`、`redisUsername`、`redisPassword`、`redisDatabase`，或对应
`REDIS_*` 环境变量、`byai:aimodel:typelist` 的 `LLM` 字段，以及模型
`url/modelCode/authToken/status/isDefault`。

如果 Zread 未安装，停止并告诉用户服务器需要安装 Zread CLI。

## 生成 Wiki

用户明确要求生成 Wiki 时调用：

```json
{
  "repositoryUrl": "https://github.com/org/repo.git",
  "branch": "main",
  "mode": "wiki_generate",
  "yes": true
}
```

`code_to_wiki` 内部会执行：

```bash
zread generate --stdio -y
```

不要解析 Zread TUI；自动化只走 stdio。

## 草稿处理

如果 `wiki_generate` 返回需要处理 draft：

- 用户要继续：`draftAction: "resume"`
- 用户要丢弃旧草稿重来：`draftAction: "clear"`
- 用户不确定：不要继续生成，解释需要用户决定

也可以单独清理：

```json
{
  "repositoryUrl": "https://github.com/org/repo.git",
  "mode": "wiki_clear_draft",
  "yes": true
}
```

## 读取 Wiki

列出页面：

```json
{
  "repositoryUrl": "https://github.com/org/repo.git",
  "mode": "wiki_list",
  "wikiVersion": "current"
}
```

读取页面：

```json
{
  "repositoryUrl": "https://github.com/org/repo.git",
  "mode": "wiki_read",
  "wikiVersion": "current",
  "wikiPage": "architecture"
}
```

## 边界

生成 Wiki 后，如果用户要审核、通知管理员或发布知识库，切换到
`wiki-review-publish` skill。不要让 `code_to_wiki` 做上传、通知、审核或发布。
