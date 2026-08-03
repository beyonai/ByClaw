# Feishu FWS 采集桥接

飞书采集意图由 `knowledge-collection` 统一编排。命中本桥接后，先声明“委派采集模式”，再加载并遵循
`fws` skill 及匹配的产品参考。`knowledge-collection` 负责采集目录、`raw/`、`markdown/`、
`sanitized/items/`、`sanitized/metadata.json`、`collection-result.json`、预览和唯一后处理选择；
`fws` / `lark-cli` 只负责飞书产品路由、命令、身份、授权、权限、真实 token、分页和只读取数。

## 来源路由

| 输入 | 委派能力 |
|---|---|
| 飞书文档、云盘文件或 Wiki 内容 | `docs` / `drive` / `wiki` |
| 飞书妙记、会议转写、AI 笔记或录音 | `vc` / `minutes` |
| 电子表格或 Base 记录 | `sheets` / `base` |
| 聊天、消息历史或资源文件 | `im` |
| 日历、任务、邮件、审批、考勤、通讯录或幻灯片 | 匹配的 `fws` 产品能力 |

仅允许读取、搜索、导出、下载和采集。创建、编辑、发送、审批、移动、权限变更或删除飞书资源属于直接 `fws` 写操作，
不能进入本采集桥接。

飞书采集不得通过浏览器、curl、直接 HTTP/API 或通用网页抓取降级。产品能力不支持时，仅可按 `fws` 的 OpenAPI
参考处理已检查 schema 的只读请求；其他替代工具必须先经用户确认，且不属于本桥接。

## 执行与认证

1. 加载并遵循 `fws` skill，再按 URL 或产品意图加载 `references/products/<product>.md`。
2. 优先使用 `lark-cli <service> +<shortcut>`；业务命令使用 `--format json`，用户可见个人资源按 `fws` 规则选择
   `--as user`。
3. 成功依据进程退出码或顶层 `ok == true`；不得把嵌套 OpenAPI `code` 当作唯一成功条件。
4. 缺少 OpenClaw 飞书渠道时，遵循 `fws` 的渠道配置流程；用户身份 401/403、失效登录、`missing_scope` 或
   `permission_violations` 时，遵循 `fws` 的授权 split-flow，只请求实际报告缺失的 scope。`lark-cli 1.0.78` 的
   `im +messages-search --no-reactions` 仍可能预检 reactions scope，必须如实报告，不得把无关 scope 伪称为已授权。
   若 QR 生成失败而返回验证 URL，必须展示该**可点击**链接并同时说明 QR helper 失败；不得阻塞、伪造二维码或宣称认证成功。
5. 不得在聊天、原始产物或规范化产物写入 App Secret、access/refresh token、device code、Cookie 或会话。

### 妙记转写

妙记 URL 或 minute token 采集需加载 `vc` 产品参考，并使用真实 minute token：

```bash
lark-cli minutes +detail --minute-tokens <minute-token> --transcript --as user --format json
```

若命令产生转写文件，必须读取实际生成的文件名和内容，保留说话人、时间戳、顺序和正文；不得猜测文件名或编造
不存在的摘要、章节、录音或转写。分页或文件读取中断时保留成功结果，在 `sanitized/metadata.json` 写入
`partial: true` 与非敏感失败位置。授权中断发生在相对时间窗口时，恢复后必须重新计算结束时间，或补采并按
`message_id` 去重；不得把中断前的窗口误报为完整结果。

### 消息与通讯录完整性

- 消息历史先搜索，再以每批最多 50 条的 `mget` 获取正文；比较返回 ID 与请求 ID，缺失、重复或失败时保留 partial/missing
  信息，未比较前不得宣称完整。
- 通讯录使用 `contact +search-user` 及真实查询/筛选条件。“我的联系人”含义不清时先澄清；命令成功返回零条是有效结果，
  不得捏造联系人。

## 私有产物

采集根目录必须使用 `0700`，写入的 raw、markdown、sanitized 与 JSON 文件必须使用 `0600`。若工作区内的回退目录
没有被 gitignore，必须改用工作区外的私有目录并明确报告；不得暂存、提交或上传任何采集产物。原始 CLI 输出和转写文件描述
都须先进行秘密扫描，规范化结果只保留完成采集所需的非敏感字段。

## 规范化产物

采集根目录遵循 [collection contract](../collection-contract.md)，至少写入：

```text
collection-result.json
raw/
  metadata.json
  <lark-command>.json
markdown/
  <normalized-content>.md
sanitized/
  metadata.json
  items/
    <normalized-content>.md
```

- `raw/` 保存已秘密扫描的 CLI JSON 和真实导出文件描述；`markdown/` 保存规范化正文；`sanitized/items/` 保存净化正文。
- `collection-result.json` 顶层只能使用主契约固定字段，`source` 写 `fws`，`backend` 写 `lark-cli`。
- 每个 `items[].fileName` 与 `items[].markdown` 必须是采集根目录内指向实际 `sanitized/items/*.md` 文件的相对路径。
- 来源执行器不得询问或执行 `入库 / 知识整理 / 跳过`；仅由 `knowledge-collection` 在采集后执行该选择。
