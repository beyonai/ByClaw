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
| `members` | 按 `projectId` 查项目成员（`userId` / `userCode` / `userNumber` / `userName` / `role`） |
| `projects` | 列候选项目（`projectId` / `projectName`），`projectId` 缺失时用来让人从列表里选 |
| `resolve-project` | 按 `sessionId` 反查所属项目，定时任务用它自己拿到 `projectId` |

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
node scripts/notice-send.mjs members --project-id 7 --with-phone   # 仅当要按手机号精确匹配联系人
```

返回：

```json
{"ok":true,"projectId":7,"total":2,"members":[
  {"userId":10000022,"userCode":"zhangsan","userName":"张三","userNumber":"0012345678","role":"owner","agentName":"架构数字员工"},
  {"userId":10000023,"userCode":"lisi","userName":"李四","userNumber":null,"role":"member","agentName":null}
]}
```

- `userId` 直接喂 `send` 的 `notices[].userId`
- `userNumber` 是工号，**和钉钉的 `jobNumber` 是同一个值** —— 连接器按人匹配时首选它（`dws aisearch person --dimension jobNumber`）：唯一、精确，而且不是敏感个人信息。为空表示这个人没录工号，降级到 `phone`
- `userCode` 是系统内部登录账号，**不是工号**，外部系统不认识它，不要拿它去匹配联系人
- `userName` 是人的真实姓名，最后兜底用（如 `dws contact user search --query`），模糊、会重名、也会搜不到
- `role` 常见取值 `owner` / `creator` / `member`，按角色筛收件人时用
- `agentName` 非空表示该成员绑了数字员工；**`userId` 仍是真人**，不要因为有 `agentName` 就跳过
- `phone` **默认不返回**，只有加 `--with-phone` 才有。它是工号缺失时的兜底精确匹配项（`dws contact user search-mobile --mobile`）。取到之后直接传给连接器命令，**不要打印、不要写进任何文件、不要放进通知正文或汇报里**

匹配优先级：**`userNumber`（工号）→ `phone`（手机号）→ `userName`（姓名）**。前两个精确，姓名是模糊兜底。工号能覆盖时就不用取手机号。

`userId` 和 `userCode` 都为空的行已被过滤，不会返回。

## 列候选项目（`projectId` 缺失时用）

`members` 必须有 `projectId`，而 `projectId` 常常没随任务传下来。这时**不要猜**，用这个命令列候选，让人从列表里选一个：

```bash
node scripts/notice-send.mjs projects
node scripts/notice-send.mjs projects --keyword 研发 --size 20
```

返回：

```json
{"ok":true,"total":2,"projects":[
  {"projectId":7,"projectName":"研发闭环","projectType":"develop","sessionCount":12},
  {"projectId":8,"projectName":"客服助手","projectType":"normal","sessionCount":3}
]}
```

用途只有一个：把「`projectId` 是多少？」这种开放式追问，变成「是这几个里的哪个？」的选择题。
只读，不产生任何通知。

## 按会话反查项目（定时任务优先用这个）

`projects` 需要有人来选，定时任务没人可问。会话本身记着自己属于哪个项目，直接反查：

```bash
node scripts/notice-send.mjs resolve-project --session-id 990
```

```json
{"ok":true,"bound":true,"sessionId":990,"projectId":7,"projectName":"研发闭环","projectType":"develop"}
```

会话没绑项目时返回 `{"ok":true,"bound":false,"projectId":null}`。
**`bound:false` 不是调用失败**，`ok` 仍是 `true`：它表示"这个会话确实没有项目"，
调用方据此走自己的兜底（有人在场就问，没人就停），不要当成故障重试。

顺序上先 `resolve-project`，拿不到再 `projects`。只读，不产生任何通知。

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
- **不要**默认带 `--with-phone`。先看 `userNumber` 够不够用；手机号是个人信息，只在工号为空时才取，取到后只喂给连接器命令，不打印、不留档
- **不要**拿 `userCode` 去外部系统匹配人。它是内部账号，钉钉/企微都不认识它；工号是 `userNumber`
- **不要**把 `bound:false` 当成接口故障去重试或改用别的接口 —— 它是"没绑项目"这个事实本身
- **不要**发钉钉、企微消息 —— 那是 `dws` / `wecom` 连接器技能的事

## 失败码

| 错误码 | 含义 | 处理 |
|---|---|---|
| `NOTICE_TARGET_UNRESOLVED` | 有收件人既没 `userId` 也没 `userCode` | 调用方补齐寻址字段后重试 |
| `NOTICE_SENDER_UNRESOLVED` | 运行身份不可用 | 运行环境问题，上报，不要索要账号 |
| `NOTICE_BACKEND_REJECTED` | 后端拒绝（如用户不存在） | 看 `detail`，核对收件人 |
| `NOTICE_BACKEND_UNREACHABLE` / `NOTICE_BACKEND_TIMEOUT` | 服务不可达 | 重试一轮，仍失败上报 |
| `NOTICE_INPUT_MISSING` / `NOTICE_INPUT_NOT_JSON` | payload 缺失或不合法 | 修 payload |
| `NOTICE_SESSION_ID_MISSING` | `resolve-project` 没给 `--session-id` | 补参数 |
| `NOTICE_FIELD_EMPTY` | `title` 或 `content` 为空 | 补文案 |
