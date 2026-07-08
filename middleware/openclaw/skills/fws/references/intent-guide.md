# 意图路由指南

当用户请求难以判断归属哪个飞书产品时，参考本指南。

## 易混淆场景

| 用户说... | 真实意图 | 应该用 | 不要用 | 理由 |
|-----------|----------|--------|--------|------|
| "给张三发个消息" | IM 单聊 | `im` + `contact` | `mail` | 飞书聊天消息，不是邮件 |
| "给张三发邮件" | 邮箱发信 | `mail` + `contact` | `im` | 邮件要走草稿/发送确认 |
| "约张三明天下午开会" | 创建日程 | `calendar` + `contact` | `vc` | 未来会议安排是日历 |
| "找一下昨天的会议记录" | 历史会议/纪要 | `vc` | `calendar` | 已结束会议含即时会议，日历会漏 |
| "总结这条妙记" | 妙记产物 | `vc/minutes` | `docs` | 先拿会议产物，再按需读取文档 |
| "在妙记里加一个待办" | 妙记 AI 待办 | `minutes` | `task` | 妙记待办不是飞书任务 |
| "给我创建一个待办" | 飞书任务 | `task` | `approval` | 普通待办不是审批单 |
| "同意这个待办" | 审批待办 | `approval` | `task` | 同意/拒绝通常是审批动作 |
| "帮我建一个项目跟踪表" | 多维表格 | `base` | `sheets` | 有字段/记录/视图，适合 Base |
| "把这个 Excel 数据写到表格" | 电子表格 | `sheets` 或 `drive` | `base` | 在线 sheet 操作走 `sheets`；导入成 Base 才走 `drive +import --type bitable` |
| "复制这篇文档" | 云空间文件复制 | `drive` | `docs` | 复制资产不要 fetch 后重建 |
| "改这篇文档的正文" | 云文档编辑 | `docs` | `drive` | 正文块级内容由 docs 管 |
| "给文档加评论" | 云空间评论 | `drive` | `docs` | 评论在 Drive 文件能力里 |
| "把这个文档放进知识库" | Wiki 节点/Drive 迁移 | `wiki` 或 `drive` | `docs` | 组织位置不是正文编辑 |

## 跨产品工作流

### 给同事发飞书消息（contact -> im）

```bash
lark-cli contact +search-user --query "张三" --as user --format json
lark-cli im +messages-send --user-id <open_id> --text "请查收" --as bot --format json
```

多候选用户时，先列候选让用户选，不要默认选第一条。

### 创建日程并邀请同事（contact -> calendar）

```bash
lark-cli contact +search-user --query "张三" --as user --format json
lark-cli calendar +create --summary "项目沟通" --start "2026-07-08T14:00:00+08:00" --end "2026-07-08T15:00:00+08:00" --attendee-ids <open_id> --as user --format json
```

时间、参会人、会议室不明确时先追问；涉及会议室先用 `calendar` reference 的推荐/查空流程。

### 从文档里的表格/多维表继续下钻（docs -> sheets/base）

读取文档后如果正文里出现嵌入表格或 Base token：
- `<sheet token="...">` 或 sheets 链接 -> 切 `sheets`。
- `<bitable token="...">`、`<base_refer>` 或 base 链接 -> 切 `base`。

不要只把嵌入标签当普通文本总结。

### 查会议并整理纪要（vc -> minutes/docs）

```bash
lark-cli vc +search --query "周会" --start "2026-07-01" --end "2026-07-07" --as user --format json
lark-cli vc +detail --meeting-ids <meeting_id> --as user --format json
```

需要 AI 总结/待办/逐字稿时，再根据返回的 `minute_token` 或 `note_id` 进入 `minutes`/`docs`。用户要求重新总结时，优先基于原始逐字稿，不要直接照搬 AI 总结。

### 文件导入分流（drive -> docs/sheets/base/slides）

- 本地 `.docx` / `.md` / `.txt` / `.html` 导入在线文档 -> `drive +import --type docx`。
- 本地 `.xlsx` / `.csv` 导入电子表格 -> 优先 `sheets +workbook-import`；如明确要多维表格才 `drive +import --type bitable`。
- 本地 `.pptx` 导入幻灯片 -> `drive +import --type slides`。
- 导入完成后的内容操作再切对应产品。
