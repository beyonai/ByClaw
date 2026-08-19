---
name: notice
description: 发平台站内信通知，以及按项目查成员名单（含姓名、工号、角色）。当任务要求「通知相关人员」「发站内信」「站内通知」「提醒某人处理」「通知项目成员」，或需要拿到某个项目的成员名单用于寻址时使用。只负责投递与寻址，不负责判断该不该通知、通知谁、写什么文案 —— 那是调用方（如 requirement-notify）的职责。不发钉钉/企微消息，那走 dws / wecom 连接器技能。
metadata:
  openclaw:
    requires:
      bins: [node]
byclaw_managed: true
---

# 站内信技能

> **读者**：大模型 / AI Agent。
> **一句话**：站内信只能通过本技能的 `notice-send.mjs` 发，脚本内部自己解析凭据和服务地址，你不需要也拿不到 token、URL、请求头。

## 命令入口（唯一）

```bash
node scripts/notice-send.mjs help
```

两个命令：

| 命令 | 用途 |
|---|---|
| `send` | 批量发站内信 |
| `members` | 按 `projectId` 查项目成员（`userId` / `userCode` / `userName` / `role`） |

## 发站内信

入参走 stdin 或 `--input <文件>`，都是同一份 JSON。**优先用 `--input` 落一个临时文件**，正文含中文、引号、换行时比 shell 管道稳。

```bash
node scripts/notice-send.mjs send --input /tmp/notice-payload.json
```

payload 结构：

```json
{
  "title": "批次默认标题",
  "content": "批次默认正文",
  "priority": "medium",
  "notices": [
    { "userId": 10000022, "priority": "high" },
    { "userCode": "lisi", "title": "单条可覆盖标题", "content": "单条可覆盖正文" }
  ]
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `title` | 是（批次或单条给一个） | ≤200 字符，超出自动截断并补 `...` |
| `content` | 是（批次或单条给一个） | ≤2000 字符，超出自动截断 |
| `priority` | 否 | `low` / `medium` / `high`，或直接 1-4；默认 `medium` |
| `notices[].userId` | 二选一 | 收件人用户 ID，精确寻址，**优先用这个** |
| `notices[].userCode` | 二选一 | 收件人工号，`userId` 缺失时用 |

单条的 `title` / `content` / `priority` 覆盖批次默认值。收件人一条都解析不出来时整批不发并报 `NOTICE_TARGET_UNRESOLVED`。

**发信人不用你给**：脚本默认用运行身份的 `USER_CODE`。它不可用时报 `NOTICE_SENDER_UNRESOLVED`，属于运行环境问题，不要向用户索要账号。

**超过 100 条自动分批**。返回里 `sent` 是实际成功条数，`failures` 列出失败的批次；部分成功时退出码为 1 但成功的批次不回滚，按 `sent` 记账。

回执（单行 JSON）：

```json
{"ok":true,"requested":2,"sent":2,"batches":1,"failures":[]}
```

## 查项目成员

```bash
node scripts/notice-send.mjs members --project-id 7
node scripts/notice-send.mjs members --project-id 7 --user-name 张三
```

返回：

```json
{"ok":true,"projectId":7,"total":2,"members":[
  {"userId":10000022,"userCode":"zhangsan","userName":"张三","role":"owner","agentName":"架构数字员工"},
  {"userId":10000023,"userCode":"lisi","userName":"李四","role":"member","agentName":null}
]}
```

- `userId` 直接喂 `send` 的 `notices[].userId`
- `userName` 是人的真实姓名，用于连接器技能按名字匹配联系人（如 `dws contact user search --query`）
- `role` 常见取值 `owner` / `creator` / `member`，按角色筛收件人时用
- `agentName` 非空表示该成员绑了数字员工；**`userId` 仍是真人**，不要因为有 `agentName` 就跳过

`userId` 和 `userCode` 都为空的行已被过滤，不会返回。

## 优先级怎么选

| 业务语义 | 传 | 落库 |
|---|---|---|
| 低优先级需求、周期汇总 | `low` | 1 |
| 常规通知（默认） | `medium` | 2 |
| 高优先级需求、阻塞项 | `high` | 3 |
| 紧急 | `4` | 4 |

`4`（紧急）留给人工或明确的升级规则，自动化批量通知不要用。

## 禁止事项

- **不要**用本技能的脚本以外的方式发站内信 —— 禁止 `curl`、直接打 HTTP 接口、拼请求、走浏览器
- **不要**读取、展示、打印、索要凭据文件、token、请求头、服务发现信息或内部路径；脚本不会输出它们，你也不要去找
- **不要**向用户索要账号、工号、token 来"补齐"发信人；解析不出来就按错误码上报运行环境问题
- **不要**每条业务记录发一条站内信。一个收件人一次通知一条汇总，20 条需求发 20 条站内信是骚扰
- **不要**自己判断"该不该通知"、"通知谁"、"文案怎么写"；本技能只投递，决策在调用方
- **不要**把 `agentName` 非空的成员当成数字员工跳过，那一行的 `userId` 是真人
- **不要**用 shell 字符串拼 payload JSON；正文里的引号、反引号、`$` 会破坏结构，用文件 + `--input`
- **不要**发钉钉、企微消息 —— 那是 `dws` / `wecom` 连接器技能的事

## 失败码

| 错误码 | 含义 | 处理 |
|---|---|---|
| `NOTICE_TARGET_UNRESOLVED` | 有收件人既没 `userId` 也没 `userCode` | 调用方补齐寻址字段后重试 |
| `NOTICE_SENDER_UNRESOLVED` | 运行身份不可用 | 运行环境问题，上报，不要索要账号 |
| `NOTICE_BACKEND_REJECTED` | 后端拒绝（如用户不存在） | 看 `detail`，核对收件人 |
| `NOTICE_BACKEND_UNREACHABLE` / `NOTICE_BACKEND_TIMEOUT` | 服务不可达 | 重试一轮，仍失败上报 |
| `NOTICE_INPUT_MISSING` / `NOTICE_INPUT_NOT_JSON` | payload 缺失或不合法 | 修 payload |
| `NOTICE_FIELD_EMPTY` | `title` 或 `content` 为空 | 补文案 |
