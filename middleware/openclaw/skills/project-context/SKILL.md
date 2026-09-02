---
name: project-context
description: 查询当前项目的详细信息、代码仓库、知识库、本体（本体库/对象/视图/场景）、成员和共享文件。用户询问“这个项目”“当前项目”“项目有哪些仓库/知识/本体/成员/文件”时使用。只读，不修改项目数据。
metadata:
  openclaw:
    requires:
      bins: [node]
byclaw_managed: true
---

# 项目上下文

这是平台底层只读能力，所有百应数字员工都可使用，不要求员工单独绑定。

## 项目标识解析

当前聊天消息末尾可能包含可信上下文：

```xml
<project_context>{"project_id":20014944,"workspace":"/by/projects/20014944"}</project_context>
```

优先读取其中的 `project_id`（兼容 `projectId`）并传给 `--project-id`。不要让用户重复提供已经在可信上下文中的项目 ID。

可信上下文没有项目 ID 时，使用当前 byai 会话 ID 调用 `--session-id` 降级反查。两者都没有时才向用户说明当前聊天未关联项目；不要猜项目。

## 命令

```bash
node scripts/project-context.mjs current --project-id 20014944
node scripts/project-context.mjs current --session-id 990
node scripts/project-context.mjs basic --project-id 20014944
node scripts/project-context.mjs repos --project-id 20014944
node scripts/project-context.mjs resources --project-id 20014944
node scripts/project-context.mjs members --project-id 20014944
node scripts/project-context.mjs files --project-id 20014944 --size 50
```

- `current`：完整项目上下文。
- `basic`：项目基本信息，位于返回 JSON 的 `project` 对象：`projectId`、`projectName`、`description`、`projectType`、`isShare`、`initStatus`、`buildIndex`、`indexSkills`、`cloudResourceId`（项目云盘知识库资源 ID）、`createBy`、`createTime`。
- `repos`：代码仓库。
- `resources`：知识库、数字员工、本体库、对象、视图、场景。
- `members`：项目成员；不返回手机号。
- `files`：项目共享文件；默认 50 条，最大 100 条，响应中的 `truncated.sharedFiles` 表示是否截断。

输出为单行 JSON。直接依据返回数据回答用户；名称为空或 `available=false` 时，要说明绑定记录存在但资源当前不可用。

## 安全约束

- 只能用本脚本查询，不要自行拼 `curl`，不要读取或展示 token、Cookie、签名盐和服务地址。
- 接口会校验当前登录用户必须能看到该项目；无权访问时不要绕过。
- 不输出手机号、存储密钥、宿主机真实路径等敏感信息。
- 本技能只读，不创建、修改、删除项目、成员、资源或文件。

## 常见失败码

| 错误码 | 含义 |
|---|---|
| `PROJECT_CONTEXT_ID_MISSING` | projectId 和 sessionId 都缺失 |
| `PROJECT_CONTEXT_SESSION_UNBOUND` | 当前会话未绑定项目 |
| `PROJECT_CONTEXT_AUTH_CONTEXT_UNAVAILABLE` | 运行环境没有登录态 |
| `PROJECT_CONTEXT_AUTH_REJECTED` | 登录态过期或被拒绝 |
| `PROJECT_CONTEXT_ACCESS_DENIED` | 当前用户无权查看项目 |
| `PROJECT_CONTEXT_BACKEND_UNREACHABLE` | 后端不可达 |
