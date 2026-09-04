---
name: project-cloud-knowledge
description: "管理 ByClaw 普通知识库或项目云盘，并复用 project-context 查询项目信息。用于访问、浏览、检索或变更知识库/云盘目录与文件，执行知识构建和知识实体处理，或查询项目基本信息、仓库、资源、成员与共享文件；用户提到知识库、项目云盘、云盘、cloudResourceId 或 cloud_resource_id 时使用。不用于管理本体、对象类型或本体对象关系。"
metadata:
  openclaw:
    requires:
      bins: [python3]
byclaw_managed: true
---

# 管理项目、云盘与知识库

只通过本 Skill 自带的 Python CLI 操作普通知识库和项目云盘。项目查询直接复用 `project-context` Skill，不在本 Skill 内重复实现。项目云盘底层是项目的知识库资源；解析出 `cloudResourceId` 后，使用与普通知识库完全相同的命令。

## 路由本轮操作

根据用户当前意图只读取对应子 Skill。多个意图可以读取多个子 Skill，但不要加载无关说明。

| 用户意图 | 读取 |
|---|---|
| 查询项目基本信息、仓库、资源、成员、共享文件，或解析项目云盘资源 ID | 读取并执行 `project-context` |
| 浏览目录、查看文件、查询构建状态、下载 | [`project-cloud-knowledge-read/SKILL.md`](project-cloud-knowledge-read/SKILL.md) |
| 新建、重命名、删除、上传、更新、构建 | [`project-cloud-knowledge-write/SKILL.md`](project-cloud-knowledge-write/SKILL.md) |
| 语义检索、文件检索、元数据条件或 DSL 过滤 | [`project-cloud-knowledge-search/SKILL.md`](project-cloud-knowledge-search/SKILL.md) |
| 知识实体发现或补全，包括项目云盘知识整理 | [`project-cloud-knowledge-entity/SKILL.md`](project-cloud-knowledge-entity/SKILL.md) |

`KnowledgeEntity` 是知识库内的实体 Markdown 目录，不是本体对象库。涉及本体、对象类型或本体关系时不要使用本 Skill。

## 准备运行环境

使用安装了 `by-framework` 的 Python3 环境。把 `argparse` 输出作为实时命令语法的唯一依据：

```bash
python3 <project-cloud-knowledge目录>/scripts/project_cloud_knowledge.py --help
python3 <project-cloud-knowledge目录>/scripts/project_cloud_knowledge.py <command> --help
```

统一使用以下调用形式：

```bash
python3 <project-cloud-knowledge目录>/scripts/project_cloud_knowledge.py <command> [options]
```

## 确定操作资源

- 普通知识库：使用用户指定或可信上下文提供的 `resourceId`。缺失时先询问，不要猜测。
- 项目云盘：先从可信上下文读取 `project_id`（兼容 `projectId`），再按 `project-context` Skill 执行 `basic` 查询，把返回的 `project.cloudResourceId` 作为后续 Python 命令的 `--resource-id`。
- 可信上下文只有会话 ID 时，按 `project-context` Skill 查询绑定项目。
- 没有 `cloudResourceId` 时，说明项目云盘未初始化或项目上下文缺失；不要用普通知识库 `resourceId` 冒充。
- 搜索范围不明确时，确认搜索一个还是多个知识库；多个资源重复传入 `--resource-id`。

## 关联任务会话

变更和实体处理子命令支持可选参数 `--session-id SESSION_ID`：

- 当前任务上下文存在会话 ID 时，必须显式传入 `--session-id`；不得依赖运行环境代为发现。
- 显式传入时，CLI 使用该会话执行请求，并向对应会话空间发送文件变更通知。
- 未传入时，请求仍正常执行，但不会发送 `X-CHAT-SESSION-ID`，也不会发送文件变更通知。

读取和检索子命令不接受 `--session-id`。`--dry-run` 不调用接口，只校验操作参数和计划。

## 接收 knowledge-collection 的采集产物

根 Agent 会转交采集阶段的交接对象：已发布时是 `publish` 返回的 `deliveryInput`，未发布时是 `status.downstreamInput`。两者都只提供正文文件清单，不携带目标知识库信息。

- 正文文件只取 `deliveryInput.files` 或 `downstreamInput.files`；图片按 Markdown 相对链接解析。不得扫描或猜测交付目录，也不得改用 `raw/`、`markdown/`、摘要或候选元数据。
- `--resource-id` 与目录按本 Skill「确定操作资源」小节自行解析；交接对象里没有这些值，缺失时先询问，不要猜测。
- 写入按写入子 Skill 执行：新增用 `upload`，覆盖已有文件用 `update-file` 并遵守其确认规则。
- 采集编排器不负责下游生命周期，本 Skill 自行维护自己的状态与确认流程。

## 通用约束

- 原样保留资源内绝对路径，例如 `/`、`/产品资料`、`/产品资料/a.md`。
- 修改前需要校验参数时使用 `--dry-run`；删除和覆盖操作遵守写入子 Skill 的确认规则。
- 单资源操作保留资源上下文；多资源检索准确保留用户指定的完整范围，不要虚构唯一资源。
- 用自然语言汇报 CLI JSON，保留项目 ID、资源 ID、路径、批次 ID、任务 ID、构建状态和检索命中定位信息。
- CLI 返回 `{ "ok": false, "error": "..." }` 时修正输入或环境；不要绕过 CLI 改调其他接口。
