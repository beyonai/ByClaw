# 群聊真人待办接口对接

适用：Web、桌面端、小程序。本文描述本次后端协议；前端页面尚未实现。所有示例 ID 都是字符串，客户端不得转为 JavaScript Number。公共库与独立租户使用相同外部接口，BE 按当前企业的数据归属路由。

## 身份与业务约定

- 外部基础路径沿用部署的 `/byaiService`，接口均使用现有登录认证；独立租户继续携带 `X-Enterprise-Id`。发起人和操作人取认证上下文，不接收客户端指定身份。
- 批次中的 `initiatorUserId` 是负责确认和验收的真人；`senderType`（`USER` / `AGENT`）与 `senderId` 是群卡片的发送者。数字员工代发时二者不同，真人直接创建时 senderId 等于 initiatorUserId。发送者由后端确定，客户端无需传入 senderType/senderId；传入这些字段也不能改变身份。
- 真人待办 ID 为 `humanTaskId`；现有员工执行任务的 `taskId` 是执行会话 ID。两者不能混用。
- 一份提案确认后生成一张群卡片，卡片内多项待办独立执行、提交和验收。没有整批验收。
- 真人可从表单直接创建一批正式待办，只生成一张正式群卡片，无需先发送群消息或提案卡片；卡片以当前真人身份展示。
- 任务确认后不可编辑、转派、取消；允许给自己派发并自行验收。截止时间可选，逾期不阻断操作。
- 每次成果提交是一份完整版本，不合并旧文字、附件。新版本取代当前版本，但旧版和验收意见仍保留。
- 提交、退回、验收通过不发送新的群成果消息，只更新原卡片状态。
- 群卡片所有群成员可见。前端仅向负责人显示处理/提交入口，向发起人显示验收和完整版本历史入口。本期不新增通用后端角色鉴权体系；前端入口隐藏不等同于接口角色隔离。
- 后端明确校验：确认人是提案发起人、确认时负责人属于群内真人、关联会话的数字员工属于待办所在群、来源消息/会话与身份一致、状态和版本，以及原有企业隔离。

## 状态

| status | 展示 | 可执行动作 |
| --- | --- | --- |
| `PENDING` | 待完成 | 提交 |
| `PENDING_REVIEW` | 待验收 | 再次提交、验收通过、退回 |
| `CHANGES_REQUESTED` | 待修改 | 继续原会话/其他会话/直接回复提交 |
| `ACCEPTED` | 已完成 | 只读，禁止再次提交 |

提案状态为 `DRAFT` / `CONFIRMED`。`revision` 为并发校验号，`latestVersion` 为成果版本序号；两者用途不同。逾期是根据 deadline 和当前时间计算的提示，不是一个待办状态。

## 接口总览

下表路径省略 `/byaiService`。成功沿用 `ResponseUtil`，即 `{ "code": 0, "msg": "...", "data": ... }`。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/group-human-task-proposals` | 创建批量草稿 |
| GET | `/group-human-task-proposals/{batchId}` | 读取提案 |
| PATCH | `/group-human-task-proposals/{batchId}` | 整体替换草稿条目 |
| POST | `/group-human-task-proposals/{batchId}/confirm` | 确认整批 |
| POST | `/group-human-task-batches` | 真人填写完整表单后直接创建正式待办 |
| GET | `/group-human-task-batches/{batchId}` | 查询群卡片及独立待办状态 |
| GET | `/group-human-tasks` | 与当前用户相关的待办分页 |
| GET | `/group-human-tasks/counts` | 当前用户首页三个待办视图的数量 |
| GET | `/group-chats/{groupSessionId}/human-tasks` | 群内全部待办分页，可多选发起人和负责人 |
| GET | `/group-human-tasks/{humanTaskId}` | 待办详情与当前版本指针 |
| POST | `/group-human-tasks/{humanTaskId}/sessions` | 创建待办专属私聊，或关联现有执行会话 |
| POST | `/group-human-tasks/{humanTaskId}/submissions/direct` | 独立文字/附件提交 |
| GET | `/group-human-tasks/{humanTaskId}/submissions` | 全部成果版本及验收记录 |
| POST | `/group-human-tasks/{humanTaskId}/reviews` | 验收当前最新版 |
| POST | `/group-chat/tasks/{taskSessionId}/complete` | 保留现有接口，关联真人待办时改为提交成果 |

## 创建、编辑与确认提案

数字员工的待办提案 tool 使用可信执行会话作为来源：

```json
{
  "sourceTaskSessionId": "9007199254742001",
  "requestId": "proposal_20261112_001",
  "items": [
    {
      "itemKey": "interview_questions",
      "title": "整理5个用户访谈问题",
      "content": "整理目标用户的核心场景与5个访谈问题",
      "assigneeUserId": "9007199254742101",
      "deadline": "2026-11-13T18:00:00+08:00",
      "acceptanceCriteria": "包含目标用户、核心场景及5个问题"
    },
    {
      "itemKey": "next_interview",
      "title": "准备下一次访谈的问题",
      "content": "整理下一次访谈提纲",
      "assigneeUserId": "9007199254742102"
    }
  ]
}
```

BE 从 `sourceTaskSessionId` 查找源群、源消息、真实发起人及 `targetAgentId`，保存 `senderType=AGENT`、`senderId=targetAgentId`。员工 ID 来自执行记录，不从来源消息的 creatorId 推断。显式提供的 groupSessionId/sourceMessageId 必须与执行记录一致。

普通用户也可只用 `groupSessionId` 创建提案，此时保存 `senderType=USER`、`senderId=当前认证用户`；sourceMessageId 可选，若提供则该消息必须存在于本群且由当前用户发出。这个接口会生成一条提案群消息；前端完整表单的一键创建使用下文的 `POST /group-human-task-batches`。

草稿允许省略 title/content/assigneeUserId，确认时三项必须完整有效。items 为 1–100 项；title 最长 512 字符，content/acceptanceCriteria 最长 100000 字符，itemKey 最长 128 字符。itemKey 应在同一提案内稳定且唯一，切换表单时保留；deadline 是带时区的 ISO 8601 时间。新增/修改草稿不代表正式待办已派发。

成功 data 包含 `batchId`、`groupSessionId`、`initiatorUserId`、`senderType`、`senderId`、可选 `sourceMessageId`、`proposalMessageId`、`status`、`revision`、`items`、`createdAt`。首版 revision 为 0。批次的发送者身份在创建时固定，修改或确认提案不会将员工发送者变为点击按钮的真人。

编辑：

```http
PATCH /group-human-task-proposals/9007199254742201
Content-Type: application/json
```

```json
{ "expectedRevision": 0, "items": [{ "itemKey": "interview_questions", "title": "整理5个用户访谈问题", "content": "整理访谈问题", "assigneeUserId": "9007199254742101" }] }
```

items 整体替换；省略旧条目等同于删除该草稿条目。保存后使用响应里的最新 revision。版本冲突先重新读取，不要静默覆盖。

确认：`POST /group-human-task-proposals/{batchId}/confirm`，body 为 `{ "expectedRevision": 1 }`。后端校验当前用户是发起人，整批校验字段和负责人身份后原子创建所有待办及群卡片；任一条失败则全部不生成。确认后 data 含 `cardMessageId`，items 是正式待办，新增 `humanTaskId`、`batchId`、`status=PENDING`、`revision=0`、`latestVersion=0`、`position`。

已确认提案再次确认返回同一批结果。确认后 PATCH 拒绝；旧版本确认拒绝。不要以按钮禁用代替服务端幂等。

## 真人直接创建

用户填写完整表单后调用：

```http
POST /group-human-task-batches
Content-Type: application/json
```

```json
{
  "groupSessionId": "11298374",
  "requestId": "human_create_interview_20261112_001",
  "items": [
    {
      "itemKey": "interview_questions",
      "title": "整理5个用户访谈问题",
      "content": "整理5个用户访谈问题",
      "assigneeUserId": "10000043",
      "deadline": "2026-11-13T18:00:00+08:00",
      "acceptanceCriteria": "要详细"
    }
  ]
}
```

支持一次创建 1–100 项独立待办，每项 title/content/assigneeUserId 必填；长度、日期及 itemKey 规则与提案确认一致。当前用户必须在目标群内，每个负责人必须是该群真人成员。senderId/initiatorUserId 均由认证用户确定；此入口不携带 sourceTaskSessionId，也不需要来源群消息。

requestId 为 1–128 位字母、数字、冒号、下划线或连字符。建议按一次表单确认动作生成，不使用任务标题作为请求标识。

后端在一个事务中校验整批条目、创建批次和全部待办、写入一条正式卡片消息；任一条目失败，整批不生成。成功 data 与 `GET /group-human-task-batches/{batchId}` 一致，主要字段：

| 字段 | 含义 |
| --- | --- |
| batchId / groupSessionId | 批次与所在群的字符串 ID |
| initiatorUserId / senderId | 当前登录真人的字符串 ID，例如梁伟童为 `10000029` |
| senderType | 固定 `USER` |
| status / revision | `CONFIRMED` / `1` |
| cardMessageId | 以该真人身份发送的正式群卡片消息 ID |
| sourceMessageId / proposalMessageId | 无来源消息及提案消息，省略或为 null |
| items | 正式待办列表，各有 humanTaskId、batchId、position、status=PENDING、revision=0、latestVersion=0 |

网络超时或重复点击重试时，使用同一 requestId 和相同表单内容，返回原批次和待办，不追加群消息、不重置已提交或验收的状态。修改表单后重新发起新的创建动作应使用新 requestId。同一 requestId 的内容或创建入口不同会报幂等冲突；不要在提案入口和直接创建入口之间复用同一个请求标识。

## 群卡片、列表与查询

持久化群消息 metadata 使用 `scene=GROUP_CHAT`，提案 `kind=HUMAN_TASK_PROPOSAL`，正式卡片 `kind=HUMAN_TASK_BATCH`，都携带 `batchId`。前端据此加载提案/批次接口渲染结构化卡片；不要从消息正文解析任务数据。

发送者按既有群消息协议展示：USER 消息使用真人 creatorId/名称、usage=1；AGENT 消息使用员工 creatorId/名称、usage=2，并保存 resComId 和 metadata.targetAgentId 供历史记录识别员工头像与 speaker。新建批次读取实际员工名称，并在 payload 中保存 senderName 展示快照；历史提案确认沿用该快照，员工改名后的新批次使用更新后的名称。卡片中的“某人发布”取批次 initiatorUserId；消息气泡的头像和姓名取消息发送者，两者不要混用。

创建提案、确认提案、真人直接创建成功后，在数据库事务提交完成后广播 `GROUP_CHAT_EVENT / MESSAGE_CREATED`。消息包含 messageId、sessionId、topicId、kind、content、creatorId、creatorName、speaker、usage、role、createdAt，以及 `metadata: {"scene":"GROUP_CHAT","kind":"HUMAN_TASK_BATCH","batchId":"批次ID"}`；提案 kind 为 HUMAN_TASK_PROPOSAL。历史消息接口同样返回上述公开 metadata，batchId 始终为字符串，不透传内部运行字段。

前端收到 MESSAGE_CREATED 后按 messageId 去重追加卡片，通过 metadata.batchId 查询提案或正式批次详情。相同创建/确认请求重试不新增消息、不再次发送 MESSAGE_CREATED；可重复收到状态刷新信号。广播是提交后的尽力通知，断线或通知失败后通过历史接口补齐；直接执行 SQL 不触发 WebSocket。

提交成果、验收、修改草稿仅发送 HUMAN_TASK_CHANGED，不发送新卡片消息。新卡片创建后也保留该刷新信号，前端不要将它当作第二条消息追加。

群事件为 `type=GROUP_CHAT_EVENT, event=HUMAN_TASK_CHANGED`，携带 sessionId、batchId、可选 humanTaskId、change、status、revision，以及可选 cardMessageId/proposalMessageId。change 为 createProposal/createDirect/updateProposal/confirm/submit/review。它是刷新信号，不是新增成果消息，也不包含提交文本、附件或完整历史。收到后重新读取对应提案/卡片；断线重连同样重取，以后端数据为准。

### 提交与验收后的卡片刷新事件

这三个操作统一使用 `GROUP_CHAT_EVENT / HUMAN_TASK_CHANGED`，不会发送 `MESSAGE_CREATED`：

| 操作 | change | status（单条待办状态） |
| --- | --- | --- |
| 首次提交或再次提交成果 | `submit` | `PENDING_REVIEW` |
| 退回修改（decision=RETURN） | `review` | `CHANGES_REQUESTED` |
| 验收通过（decision=ACCEPT） | `review` | `ACCEPTED` |

事件数据示例（ID 仅作示意）：

```json
{
  "type": "GROUP_CHAT_EVENT",
  "event": "HUMAN_TASK_CHANGED",
  "sessionId": "11298374",
  "batchId": "9007199254742201",
  "humanTaskId": "9007199254742301",
  "change": "submit",
  "status": "PENDING_REVIEW",
  "revision": 1
}
```

| 字段 | 类型 | 含义与处理 |
| --- | --- | --- |
| type / event | string | 按上述值识别待办刷新通知 |
| sessionId | string | 待办所在群；按群隔离缓存 |
| batchId | string | 原卡片关联的批次 ID，用于重新获取整张卡片 |
| humanTaskId | string，可选 | submit/review 时为发生变化的单条待办 ID；批次操作可能没有 |
| change | string | 本次操作名称；退回与通过都为 review，通过 status 区分当前状态 |
| status | string | submit/review 为单条待办状态；创建、修改提案、确认时则是批次状态，不能混用 |
| revision | number | submit/review 为单条待办并发版本号；批次操作为批次版本号，不是成果 latestVersion，也不能跨待办比较 |
| cardMessageId / proposalMessageId | string，可选 | 作用域带有消息 ID 时返回；submit/review 不保证携带，不应依赖这两个字段定位卡片 |

前端处理步骤：

1. 按 `sessionId + batchId` 定位卡片缓存；消息历史中的 `metadata.batchId` 用于建立消息与批次的映射。收到此事件不要往消息列表追加消息。
2. 调用 `GET /group-human-task-batches/{batchId}` 获取最新批次及 items，更新原卡片对应条目的状态、操作按钮和已完成数量。以查询响应为准，不把单条事件的 status 覆盖到整批或其他条目。
3. 若当前打开该待办详情，同时刷新 `GET /group-human-tasks/{humanTaskId}`；已打开提交与验收记录时，刷新其 submissions 查询。同步使“与我相关”和“待验收”列表缓存失效，按原筛选条件重新查询，避免验收通过后仍留在待验收列表。
4. 重复通知可以合并刷新；并发请求按批次串行或使用请求序号丢弃旧响应，避免较早响应覆盖新状态。不同待办的 revision 不能互相去重。事件不含成果正文、附件、验收意见或完整记录，这些内容由详情接口获取。
5. 广播在事务提交后尽力发送，不保证离线补发。提交/验收 HTTP 请求成功后，操作方也应主动刷新；断线重连或重新进入页面时重取卡片及列表，不只等待 WebSocket。卡片尚未加载时使对应缓存失效即可，不能凭刷新事件构造一条新消息。

`GET /group-human-tasks?relation=ALL&pageNum=1&pageSize=20`：relation 为 `ALL`（我发起或接收）、`INITIATED`、`ASSIGNED`；status 可选上述状态，pageSize 最大 100。响应 data 为 `{ "items": [...], "total": 2 }`。当前用户由服务端解析，不提供任意查询 userId。

### 我的待办查询视图

同一 `GET /group-human-tasks` 接口新增可选 `view`。当前用户及租户由服务端确定，前端无需传 userId。

| view | 入口 | 后端筛选 |
| --- | --- | --- |
| `PENDING_REVIEW` | 待我验收 | 发起人是当前用户，status=PENDING_REVIEW |
| `PENDING_COMPLETION` | 待我完成 | 负责人是当前用户、发起人不是当前用户，status 为 PENDING 或 CHANGES_REQUESTED |
| `PENDING_MODIFICATION` | 待我修改 | 负责人是当前用户、发起人不是当前用户，status=CHANGES_REQUESTED |

```http
GET /group-human-tasks?view=PENDING_REVIEW&pageNum=1&pageSize=20
GET /group-human-tasks?view=PENDING_COMPLETION&pageNum=1&pageSize=20
GET /group-human-tasks?view=PENDING_MODIFICATION&pageNum=1&pageSize=20
```

- 传入 view 时，服务端按该视图统一决定角色和状态条件，忽略同时传入的 relation/status。不要使用其他 status 再缩小视图。
- 不传 view 时继续支持原 relation/status 查询；空字符串或未知 view 返回 `HUMAN_TASK_INVALID_VIEW`，不会退回 ALL 查询。view 区分大小写。
- 响应仍为 data `{ "items": [...], "total": 2 }`。按待办 ID 倒序分页，total 是该视图下符合条件的全部待办数量，pageSize 最大 100；不要在前端拼接多次查询的分页结果。
- 待我修改是待我完成的子集。退回后进入两者，重新提交后从两者移出并进入发起人的待我验收；验收通过后从这三个视图移出。
- 自己给自己创建的待办不会出现在待我完成和待我修改；提交后仍会出现在自己的待我验收。需要查此类其他状态时使用原 relation/status 接口。

原查询 `relation=INITIATED&status=PENDING_REVIEW` 仍可用。卡片显示“已完成 x/y”时统计 ACCEPTED 数量，不触发整批总验收。

### 按群聊筛选列表与数量

两个 GET 接口均支持可选的 `groupSessionId`（群聊 session ID，十进制正整数字符串）：

```http
GET /group-human-tasks?groupSessionId=11298374&view=PENDING_COMPLETION&pageNum=1&pageSize=20
GET /group-human-tasks?groupSessionId=11298374&relation=ALL&pageNum=1&pageSize=20
GET /group-human-tasks/counts?groupSessionId=11298374
```

- 不传 groupSessionId：查询当前租户下、所有群中与当前用户相关的待办，保持原行为。
- 传入 groupSessionId：与现有用户归属、view 或 relation/status 条件取交集。指定群不会扩大访问范围，也不会返回该群其他人的无关待办。
- 列表 data.total 是指定群内符合当前筛选的条数；counts 的四个数字只统计指定群，total 仍为 pendingReview + pendingCompletion。
- 群不存在、当前用户在该群没有相关待办，或该 ID 仅属于其他租户时，返回空列表/total=0 或四项数量均为 0。查询不新增当前群成员资格限制，保留已有待办归属查询语义。
- 空字符串、非正整数及非法 ID 会报错，不能用空字符串表示全部群；查询全部群请省略参数。该参数可与 view 同时使用，view 只覆盖 relation/status，不覆盖群筛选。

### 群内全部待办列表

```http
GET /group-chats/11298374/human-tasks?pageNum=1&pageSize=20
GET /group-chats/11298374/human-tasks?initiatorUserIds=10000029,10000043&assigneeUserIds=10000043,10000044&status=CHANGES_REQUESTED&pageNum=1&pageSize=20
```

该接口面向当前群成员，查询群内所有成员的正式待办，包括既不是当前用户发起、也不是当前用户负责的待办。与 `/group-human-tasks?groupSessionId=...` 的“本群内与我相关”范围不同，不使用个人 view/relation 条件，也不查询尚未确认的提案。

| 参数 | 必填 | 含义 |
| --- | --- | --- |
| groupSessionId | 是，路径参数 | 群聊 ID |
| initiatorUserIds | 否 | 发起人多选，正整数字符串列表，去重后最多 100 人 |
| assigneeUserIds | 否 | 负责人多选，正整数字符串列表，去重后最多 100 人 |
| status | 否 | 单个待办状态：PENDING、PENDING_REVIEW、CHANGES_REQUESTED、ACCEPTED |
| pageNum | 否 | 默认 1，从 1 开始，最大 1000000 |
| pageSize | 否 | 默认 20，范围 1～100 |

多选参数支持逗号分隔，也支持重复参数，例如 `initiatorUserIds=10000029&initiatorUserIds=10000043`。同一字段内是 OR，不同字段之间是 AND，状态条件也取交集。省略某个人员参数或传空列表表示不限制该字段；列表中的非法/空白 ID、非正整数或超过 100 个不同 ID 会报错。筛选对象不要求仍是群成员，因此可以查询已退群人员的历史待办。

响应沿用 `{ "code": 0, "msg": "...", "data": { "items": [...], "total": 12 } }`。items 为当前页的待办基本信息，按 humanTaskId 倒序；total 为全部筛选条件下的总条数，不受分页影响。返回字段沿用待办条目（标题、内容、负责人、发起人、截止时间、验收标准、状态及版本指针等），不附带成果正文、提交附件、提交版本记录或验收记录。

后端校验当前用户属于该群、群有效且位于当前租户范围。非群成员、跨租户访问、不存在或已解散的群拒绝访问；有效群内没有匹配记录时返回 `items=[]、total=0`。群成员查询的是公开待办信息，不因此获得私聊或成果历史访问入口。原“我的待办”接口的退群后归属查询语义保持不变。

### 首页待办数量

```http
GET /group-human-tasks/counts
```

无需请求体，也无需分页、view、relation、status 或 userId 参数。支持可选查询参数 `groupSessionId`，用于只统计指定群聊。当前用户及租户由后端可信身份上下文决定，一次数据库聚合返回三个视图的数量，不查询或反序列化任务正文、附件和详细列表。

成功响应示例：

```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "pendingReview": 2,
    "pendingCompletion": 5,
    "pendingModification": 1,
    "total": 7
  }
}
```

| 字段 | 类型 | 对应列表视图 |
| --- | --- | --- |
| pendingReview | number | 待我验收，PENDING_REVIEW |
| pendingCompletion | number | 待我完成，PENDING_COMPLETION |
| pendingModification | number | 待我修改，PENDING_MODIFICATION |
| total | number | 我的待办总数，pendingReview + pendingCompletion |

APP 首页“我的待办”直接使用 `data.total`。它等于待我验收加待我完成，不再累加待我修改，因为待修改已包含在待完成中。该字段不是所有关联任务的总数，不包含已提交等待他人验收或已验收完成的任务。

无匹配任务时四个字段均为数字 `0`，不会返回 null 或省略字段。统计条件与各列表视图完全一致，total 由本次聚合结果计算，不增加数据库查询。列表与数量接口为不同请求，并发提交或验收时可能看到不同时间点的数据。

移动端进入首页时调用该接口；创建、提交、退回、验收成功后，或收到 `HUMAN_TASK_CHANGED` 通知后可合并刷新数量。断线重连、回到前台时重新查询。点击某项再请求对应 view 的分页列表，无需为首页数量加载列表。

## 在群内完成与私聊完成

群内执行请求须携带 `humanTaskId` 并继续按既有 resourceList 指定数字员工。服务端关联待办并直接认为 TASK，跳过 CHAT/TASK 分类；普通群消息仍保持既有行为。

私聊前端只列出当前群数字员工，调用待办专属会话接口：

```http
POST /group-human-tasks/9007199254742301/sessions
```

```json
{ "agentId": "9007199254742401", "entryType": "PRIVATE", "requestId": "private_open_20261112_001" }
```

该请求创建待办专属私聊并关联，重试沿用 requestId。不要用原 `/group-chats/{groupSessionId}/direct-tasks` 固定成员私聊来承担不同待办，否则会混淆提交目标。已有兼容执行会话可使用 `{ "taskSessionId": "...", "entryType": "PRIVATE" }` 关联；群内执行 entryType 为 `GROUP`。后端验证会话身份/归属及数字员工在所在群内。一会话只关联一个真人待办，一个待办可关联多个会话；重复同一关联幂等，试图把已关联会话换到另一待办拒绝。

### 多员工协作私聊

同一个 sessions 接口支持 `agentIds`，与 `agentId` 互斥。ID 使用字符串，数组不能为空，去重后最多 100 名员工；后端去重并校验每位员工属于待办所在群。去重后单名员工使用普通私聊，两名及以上使用协调私聊。

```json
{
  "agentIds": ["11223505", "11223506"],
  "entryType": "PRIVATE",
  "requestId": "private_open_20261113_001"
}
```

多员工时使用群中已配置、可用且已发布的工作助手，不自动添加工作助手或降级成多个独立私聊。缺少可用工作助手时创建失败，前端提示先配置/启用群工作助手；所选员工不在本群时同样拒绝。请求不可指定协调身份或 allowedAgentIds，执行授权以服务端持久化范围为准。

成功 data 包含以下字段（示意）：

```json
{
  "humanTaskId": "9007199254742301",
  "groupSessionId": "11298374",
  "taskSessionId": "9007199254742501",
  "entryType": "PRIVATE",
  "targetAgentId": "9007199254742400",
  "groupCoordination": {
    "schemaVersion": "byclaw.group-coordination/v1",
    "mode": "COORDINATED",
    "groupSessionId": "11298374",
    "taskSessionId": "9007199254742501",
    "coordinatorAgentId": "9007199254742400",
    "allowedAgentIds": ["11223505", "11223506"]
  }
}
```

前端进入返回的 taskSessionId，按既有私聊消息协议发送，agentId 使用响应 targetAgentId（多员工时为工作助手），不要把第一名所选员工当作主会话执行目标，也不要调用 GROUP_CHAT_SEND。groupCoordination 供展示协作范围，不能通过前端修改扩大授权。单员工响应同样提供 targetAgentId，不带协调范围。

单员工、多员工都按 requestId 控制创建幂等：同一请求重试返回原会话；变更参数需要新 requestId。新请求创建新会话，不按“待办＋员工”自动复用；继续旧会话直接使用已有 taskSessionId。协作名单创建后固定，更换名单时新建会话。创建失败不能在前端静默拆分成单员工会话。

工作助手在同一个私密主会话内调度所选员工，子会话产出由主会话汇总。主会话关联待办并提供“确认提交任务”；子员工不自动提交成果、不新增群消息。协调私聊继续使用 PRIVATE 状态，不走群内协调任务的 promote 链路。验收退回后可继续原主会话准备新成果；新提交替代上一提交的当前版本，旧版本仍保留。公开卡片只按 HUMAN_TASK_CHANGED 刷新状态，私聊过程不进入群历史。

部署需同步更新 BE、独立租户的 Tenant Node，以及 Harness 的 byclaw-integration 插件。插件会剥离外部子员工请求中的主会话发布标识，避免子员工继承主会话的提交入口；仅升级创建接口不足以完成多员工私聊执行链路。

会话中的成果准备仍使用现有 `pending-publication` / `prepare_group_task_publication`。关联真人待办后文案为“确认提交任务”，待办 ID 由持久化关联决定，不能仅靠客户端布尔参数改变 complete 语义。

`POST /group-chat/tasks/{taskSessionId}/complete` 继续提交 `{ "pendingPublicationId": "..." }`。无待办关联则保持原群发布逻辑；有关联则生成真人待办的新成果版本，不创建 TASK_RESULT 群消息，不把会话永久封死为不可重新提交的 PUBLISHED。

关联待办的 complete 响应新增 `humanTaskId`、`submissionId`、`version`、`status=PENDING_REVIEW`；`messageId=null`，客户端不得再据此跳转新群消息。同一草稿重复确认返回原提交，不产生新版本；再次提交须准备新草稿。

## 直接回复

独立 `POST /group-human-tasks/{humanTaskId}/submissions/direct`，`multipart/form-data`：

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| requestId | string | 必填，1–121 位字母、数字、下划线或连字符；同一次提交重试复用 |
| text | string | 可选，去掉空白后有效 |
| files | file[] | 可选，多附件使用重复 files 字段 |

text 和 files 至少有一项。支持纯文字、纯附件；纯文字无需项目云盘上传。不使用群输入框上传接口，不创建执行会话，也不接受任意云盘引用冒充上传。

```bash
curl -X POST "$BYAI_BASE/group-human-tasks/$HUMAN_TASK_ID/submissions/direct" \
  -H "Beyond-Token: $BYAI_TOKEN" \
  -H "X-Enterprise-Id: $ENTERPRISE_ID" \
  -F 'requestId=direct_submit_20261112_001' \
  -F 'text=访谈问题已整理，请验收。' \
  -F 'files=@./访谈问题.md'
```

上传复用当前项目云盘服务与平台限制，每次新提交使用独立目录。同名文件可出现在不同版本路径下；上传失败不产生正式提交版本，重试复用已有进度。提交后修改沙箱同名文件不会修改已转存附件。

成功 data 包含 `submissionId`、`humanTaskId`、`version`、`status`、`text`、`files`、`sourceType=DIRECT`、`taskSessionId=null`、`submitterUserId`、`createdAt`。会话提交 sourceType 为 `SESSION`。files 元素保存实际云盘 `fileId`、`fileName`、`filePath`。

## 最新版验收和版本历史

先 GET 待办详情获取 `latestSubmissionId` 和 `revision`，再 GET submissions 展示当前版正文与附件。完整历史入口只在发起人端展示。

```http
POST /group-human-tasks/9007199254742301/reviews
Content-Type: application/json
```

```json
{
  "requestId": "review_20261112_001",
  "submissionId": "9007199254742502",
  "expectedRevision": 2,
  "decision": "RETURN",
  "opinion": "请补充目标用户的筛选标准"
}
```

decision 为 `ACCEPT` / `RETURN`；退回意见必填，通过意见可选。成功 data 包含 reviewId、humanTaskId、submissionId、decision、opinion、reviewerUserId、createdAt、status、revision。

验收操作只允许当前最新版。打开验收页后若收到新提交，旧页面提交通过或退回都失败，需刷新后重新确认；若验收通过先成功，随后提交被拒绝。不得收到冲突后自动改用最新版重放原验收操作。

历史 data 为 `{ "items": [...] }`，按版本倒序，每项有成果字段、`superseded` 和 `reviews`。superseded=true 显示“已被新版替代”，但保留其原有退回意见和时间。不得仅显示最新意见覆盖旧验收记录。

## 错误与重试

业务错误带 `HUMAN_TASK_` 标识，客户端沿用统一失败响应处理，不能只判断 HTTP 200。版本/状态冲突不自动重试写入；刷新后由用户决定。错误表现仍经过部署现有的统一异常封装。

| 标识 | 前端处理 |
| --- | --- |
| HUMAN_TASK_STALE_PROPOSAL | 提案已被修改，重新读取并提示 |
| HUMAN_TASK_PROPOSAL_CONFIRMED | 已确认，不再编辑 |
| HUMAN_TASK_INITIATOR_REQUIRED | 当前用户不是提案发起人 |
| HUMAN_TASK_ITEM_INCOMPLETE | 完成所有条目必填项后再确认 |
| HUMAN_TASK_ASSIGNEE_NOT_GROUP_MEMBER | 刷新成员并重新选择负责人 |
| HUMAN_TASK_AGENT_NOT_GROUP_MEMBER | 刷新数字员工列表，不继续创建/关联 |
| HUMAN_TASK_SOURCE_MISMATCH / SESSION_SCOPE_MISMATCH | 来源或会话与身份不一致，终止操作 |
| HUMAN_TASK_SOURCE_AMBIGUOUS | 来源执行身份不一致，不能猜测发送者；核对来源会话 |
| HUMAN_TASK_IDEMPOTENCY_MISMATCH / HUMAN_TASK_IDEMPOTENCY_CONFLICT | 同一请求标识内容不同，不能自动覆盖或当作成功 |
| HUMAN_TASK_CONTENT_REQUIRED / HUMAN_TASK_EMPTY_SUBMISSION | 文字和附件至少一项 |
| HUMAN_TASK_STALE_VERSION / STATE_CHANGED | 状态已变化，重新读取并由用户决定 |
| HUMAN_TASK_ACCEPTED / HUMAN_TASK_ALREADY_ACCEPTED | 待办已通过，关闭提交入口 |
| HUMAN_TASK_OPINION_REQUIRED | 退回时补充意见 |
| HUMAN_TASK_STALE_PUBLICATION / HUMAN_TASK_DRAFT_CHANGED | 成果草稿已变化，重新加载草稿 |

新提案/真人直接创建/直接提交/验收每次用户动作创建新的 requestId；网络重试保留同键和原内容。PATCH 提案通过 expectedRevision 防止覆盖。不要把 unknown/network timeout 当成失败后无条件新建，否则会生成重复业务记录。

附件下载复用现有项目云盘下载接口，使用返回的 cloudResourceId 和 filePath；不要从沙箱 sourcePaths 下载历史版本。工作区文件仅是待上传来源，已提交记录以云盘引用为准。

## 数字员工待办提案工具配置

Harness 使用现有 `@byclaw/dsh-group-task-publication` 插件，新增 `taskManagerAgentIds` 配置，填获准使用待办提案工具的数字员工资源 ID 字符串，例如 `["12345"]`；默认空数组，不向所有员工暴露提案工具。配置名表示工具能力范围，不要求员工使用某个名称。员工可以任意命名或改名，启用工具和识别发送者始终按 ID 匹配。

匹配可信 `groupChat.targetAgentId` 的 DSH Agent 会注册 `prepare_group_human_tasks`。模型参数仅包含 items、更新时的 batchId/expectedRevision；sourceTaskSessionId、发起人和认证信息由宿主上下文确定。登录头来自 resolveAuthHeaders，不使用群历史 contextToken 代替用户登录。

工具只创建/更新草稿，不确认正式待办；结果仅返回 batchId/revision，客户端按群事件和详情 API 渲染提案。员工提示词应指明用户派真人任务时调用此工具，成功后说明“请确认提案”，不能声称任务已经派发。员工实际配置由管理员录入，本次不预置生产员工 ID 或自动写员工数据库。

已绑定真人待办时，成果工具保留原上传前草稿语义，文案改为等待确认提交；工具本身不上传、不提交、不发送群消息。该提案工具面向 DSH Agent 工具运行时；其他 CLI runtime 不自动获得新增提案工具。

## 联调顺序

1. 真人从表单直接创建两项待办：群只新增一条 USER 正式卡片，无提案消息；同请求重试不新增卡片，不同内容复用 requestId 报冲突。
2. 启用提案工具的数字员工收到群消息生成两项草稿，发起人切换编辑并确认；提案和正式批次卡片均显示真实员工身份，发起人仍为原真人。换用不同名称的员工重复验证，名称不得固定。
3. 两位负责人分别执行，确认多会话各自携带同一项 humanTaskId，另一项不受影响。
4. 纯文字/纯附件直接回复，检查版本目录隔离及重复请求返回同结果。
5. 待验收时再次提交，旧版显示替代；在旧验收页点击通过/退回均应失败。
6. 退回原会话继续对话、重新准备草稿、再次提交；通过后所有提交入口被拒绝。
7. 公共库与独立租户分别跑通，同步检查普通 complete 仍发布群消息，真人待办 complete 不发布群成果消息。
8. 刷新、重连、逾期和退群不删除待办历史；验收通过不新增群消息。


## 数据库升级

本次直接更新 `V0.7.0` 平台和租户建表 SQL：`byai_group_human_task_batch` 新增 `sender_type`、`sender_id`，`source_message_id` 允许为空；其他待办表的业务关联不变。批次 payload 同步保存 senderType/senderId，不能只填数据库列而遗漏详情接口使用的 payload。

新库使用 V0.7.0 主建表 SQL。已执行旧 V0.7.0 且待办表仍为空的开发库，执行以下语句即可：

```sql
ALTER TABLE byai.byai_group_human_task_batch
    ADD COLUMN sender_type VARCHAR(16) NOT NULL;

ALTER TABLE byai.byai_group_human_task_batch
    ADD COLUMN sender_id BIGINT NOT NULL;

ALTER TABLE byai.byai_group_human_task_batch
    ALTER COLUMN source_message_id DROP NOT NULL;

ALTER TABLE byai.byai_group_human_task_batch
    ADD CONSTRAINT ck_human_batch_sender_type
    CHECK (sender_type IN ('USER', 'AGENT'));
```

独立租户的 baseline/update SQL 同步更新后，部署前仍需按既有流程生成新的租户迁移发布包。没有修改 initdb 或 `.applied`。

## 本次交付验证范围

本轮发送者模型与真人直接创建的验证结果：

- Java 定向 60 项通过；公共库 PostgreSQL Mapper 另行实库验证通过。覆盖整批事务回滚、并发幂等、身份伪造、来源归属、消息 role/speaker、资源改名及升级后旧请求重放。
- Tenant Node 相关回归 106 项通过，10 项真实环境测试跳过；其中真人待办 23 项使用隔离 PostgreSQL，包含权威名称覆盖过期群成员姓名、内部名称不影响幂等、解散群拒绝新建及历史重试。
- V0.7.0 主脚本直接修改 CREATE 定义，空开发库仅需上述四条 ALTER。dry-run 布局及 DDL/DML 分类通过；版本覆盖审计仍提示 V0.7.0 未登记在 `.applied`，未执行发布合并操作。
- 全量 Maven verify 运行 4868 项，1 项失败、0 errors、60 项跳过。失败仍是未修改模块的 `SharedSandboxGatewayTest.revokedUserAfterBeRestartMustFinishCleanupBeforeExclusiveFallback`。
- Tenant Node 全量回归曾运行到 641 项通过、5 项失败、91 项跳过，并有 Redis 初始化错误：`architecture.test.ts` 的现有 MemberGroupRemoval 层依赖断言、V0.6/V0.7 旧发布包的四项 SCRIPT_DIGEST_MISMATCH，以及缺少 `redis-server`。这些不等同于本轮定向回归通过；发布前仍需处理环境及重新生成正确迁移包。

上述全量回归不能视为全部通过。独立代码复核发现的消息 role、租户员工改名和解散群校验问题已修复，并完成相关回归。

openGauss、真实 Agent 模型调用、生产项目云盘上传及前端联调尚未验证。数字员工需配置真实资源 ID 到 `taskManagerAgentIds` 后才启用提案工具；真人直接创建不依赖此配置。

### 多员工私聊补充验证（2026-11-13）

- Java 相关测试 130 项通过、1 项环境测试跳过，包括多员工私聊的 14 项回归；完整 verify 4886 项中 1 项失败、60 项跳过，失败仍为上述 SharedSandboxGatewayTest。
- Tenant Node 多员工待办 PostgreSQL 回归 27 项通过；历史查询回归 32 项通过，TypeScript 类型检查通过。
- Harness 主会话提交标识不传给子员工的定向回归通过；完整插件验证受缺失 workspace 依赖限制，尚未完成。
- 未进行真实 Agent 协作、前端联调或 openGauss 验证；不能将单元测试视为线上执行验证。

### 我的待办视图补充验证（2026-11-14）

- Java 定向测试 30 项通过，包含 H2/MyBatis 实际列表与 count 查询、HTTP 参数绑定、旧查询兼容及非法 view 校验。
- Tenant Node 定向测试 46 项通过，其中真实 PostgreSQL 37 项，覆盖跨租户、不同发起人/负责人、自派任务、分页及退回后重新提交。
- 完整 Maven verify：4924 项，2 项失败、0 errors、60 项跳过。失败位于本次未修改的 `SharedSandboxGatewayTest.revokedUserAfterBeRestartMustFinishCleanupBeforeExclusiveFallback` 和 `LogCenterControllerTest.missingDefaultSourceNeverReachesPlatform`。
- Node 类型检查未通过：本次未修改的 `src/application/history/group-responses.ts:15:48` 报 TS2532（可能为 undefined）。未修改该模块。
- 本次无表结构或迁移变更，未进行 openGauss 或前端联调。

### 首页数量接口补充验证（2026-11-14）

- Java 待办模块回归 77 项通过、1 项环境测试跳过，覆盖数量聚合、零结果、损坏正文不影响统计，以及 `/counts` 优先于任务详情路由。
- Node 定向 49 项通过，其中真实 PostgreSQL 39 项，验证计数与列表条件一致、单条聚合查询、租户/用户隔离及状态变化；临时数据库已停止。
- Node 类型检查仍受上述未修改的 group-responses.ts TS2532 阻断；未做 openGauss 和移动端联调。
- 本轮完整 Maven verify 为 4927 项，2 项失败、0 errors、60 项跳过，仍是上述共享沙箱和日志中心测试。

### 群聊筛选补充验证（2026-11-14）

- Java 待办回归 80 项通过、1 项环境测试跳过；覆盖多群、分页、旧筛选、统计及非法 groupSessionId。
- Node 定向 60 项通过，其中真实 PostgreSQL 50 项，验证群筛选与角色/租户限制取交集、查询占位符及数量统计。
- TypeScript 检查仍为既有 group-responses.ts:15:48 TS2532；未修改该模块。没有表结构变更，尚未做 openGauss 或移动端联调。
- 完整 Maven verify 共 4930 项，2 项失败、0 errors、60 项跳过，仍为上述共享沙箱和日志中心测试。

### 群内全部待办补充验证（2026-11-14）

- Java 定向 47 项通过，覆盖 H2/MyBatis 过滤与计数、群授权、HTTP 多选解析及共享/独立租户转发。
- Tenant Node 定向 65 项通过，其中真实 PostgreSQL 54 项，覆盖多选交集、权限隔离、只读动作及提交/验收记录不进入返回列表。临时数据库已停止。
- 完整 Maven verify 为 4941 项，2 项失败、0 errors、60 项跳过，仍为上述 SharedSandboxGatewayTest 和 LogCenterControllerTest。Node 类型检查仍为既有 group-responses.ts:15:48 TS2532。
- 无数据库迁移变更，未进行 openGauss 或移动端联调。
