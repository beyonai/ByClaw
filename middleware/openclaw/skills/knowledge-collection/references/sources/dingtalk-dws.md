# DingTalk DWS 采集桥接

钉钉采集意图由 `knowledge-collection` 统一编排。命中本桥接后，先声明“委派采集模式”，再加载并遵循
`dws` skill。`knowledge-collection` 负责采集意图、产物目录、规范化契约和后处理；`dws` 负责钉钉产品
与 URL 路由、命令与参数、ID 和 taskUuid、flags、分页、权限、认证以及危险操作确认。

## 来源路由

以下来源或产品统一委派给 `dws`：

| 输入 | DWS 产品能力 |
|---|---|
| `shanji.dingtalk.com`、AI 听记、会议纪要、摘要、待办、发言人与转写 | `minutes` |
| `alidocs.dingtalk.com` 文档、在线表格、云盘链接 | `doc` / `sheet` / `drive`，具体 URL 分流由 `dws` 决定 |
| 钉钉文档、在线表格、云盘文件、知识库内容 | 对应的 `doc` / `sheet` / `drive` / `wiki` 能力 |
| 日历、待办、日志、邮件、通讯录、群聊数据 | 对应的 `calendar` / `todo` / `report` / `mail` / `contact` / `chat` 能力 |

必须先加载并遵循 `dws` skill 及其按需引用的当前产品参考。命令是否存在、参数名、ID/taskUuid 提取、
分页 flags 和终止条件均以当前 `dws` 及其 `--help` 为准，不得猜测。所有支持格式化输出的命令使用
`--format json`。DingTalk 的写入、删除或其他高影响操作是否危险、何时向用户确认及何时使用确认 flag，
完全由 `dws` skill 决定。

## 严禁降级

钉钉采集只能使用 `dws`，不得通过 byCLI 或浏览器降级，也不得使用 curl、直接 HTTP/API 或通用网页
抓取作为替代方案。若 `dws` 不可用，或当前 `dws` 明确不支持该操作，报告不可用或不支持的步骤并停止；
不得编造替代数据。权限拒绝、无效 ID 和数据不存在也按 `dws` 的错误语义报告，不得切换执行器绕过。

认证完全遵循 `dws` skill 的当前认证说明。这里不复制设备登录、凭据目录或重试步骤，也不得在聊天、
原始产物或规范化产物中暴露或持久化 token、Cookie、OAuth 凭据、client secret 等秘密。

## AI 听记默认完整采集

对 `shanji.dingtalk.com` 听记 URL 或没有进一步限定的“采集这条 AI 听记”请求，默认完整采集：

- info；
- summary；
- keywords；
- todos；
- full transcription（完整转写）。

taskUuid 或其他标识符必须按 `dws` 的当前规则从输入或命令结果取得，不得编造。完整转写必须根据当前
`dws minutes ... --help` 暴露的分页 flags 持续拉取，直到当前响应表明没有下一页；不得沿用已过期的
cursor/token 假设。如果中途分页失败，保留已成功取得的页面和 Markdown，并记录失败的游标或分页标识。

## 规范化产物

采集目录和规范化写入遵循 [collection-contract.md](../collection-contract.md)。根目录写入
`collection-result.json`，并保留以下产物：

```text
collection-result.json
raw/
  metadata.json
  <dws-command-or-page>.json
markdown/
  <normalized-content>.md
sanitized/
  metadata.json
  items/
    <normalized-content>.md
```

- `raw/` 保存经秘密扫描与必要脱敏后的 DWS JSON；不得写入凭据或秘密。
- `markdown/` 保留 DWS 内容转换后的 Markdown；`sanitized/items/` 保存供预览和后处理的净化 Markdown，
  并明确写入 `sanitized/metadata.json`。`raw/metadata.json` 与 `sanitized/metadata.json` 均遵循主契约且不含秘密。
- `items[].fileName` 和 `items[].markdown` 使用相对于采集根目录的相对路径，且指向实际存在的规范化
  `sanitized/items/` 文件。
- `collection-result.json` 只能使用主契约的固定 schema 字段：`schemaVersion`、`title`、`source`、
  `backend`、`url`、`filters`、`items`，不得添加额外顶层字段。其中 `source`/`backend` 记录 `dws`，
  `url` 记录原始 URL。
- DWS 的 `sourceProduct`、`operation`、命令、分页与 `partial` provenance 写入指定的 metadata 文件，
  尤其是 `sanitized/metadata.json`；不得把这些信息作为 `collection-result.json` 的额外顶层字段。
- 权限失败时报告当前身份无权访问相应钉钉对象；不得用替代来源补齐。
- 部分命令或分页失败时保留成功结果，在 `sanitized/metadata.json` 中设置 `partial: true`，并记录失败
  步骤及分页位置；不得把 partial 结果表述为完整结果。

来源执行器 `dws` 只返回采集结果，不得询问或执行 `入库 / 知识整理 / 跳过`。持久化、预览以及唯一后处理选择由
`knowledge-collection` 按 [post-processing.md](../post-processing.md) 统一完成。
