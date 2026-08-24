---
name: by-knowledge-manager
description: "仅通过 Python CLI 管理 ByClaw 知识库内容。用于浏览或变更知识库目录和文件、导入与构建内容、发起知识实体发现或补全，以及在一个或多个知识库中执行语义检索、文件检索或 Agent DSL 元数据过滤。不用于管理本体对象库，也不处理本体、对象类型或本体对象关系。"
---

# 管理 ByClaw 知识库

只通过本 Skill 自带的 Python CLI 操作知识库。

## 路由本轮操作

根据用户当前意图只读取对应子 Skill。多个意图可以读取多个子 Skill，但不要加载无关说明。

| 用户意图 | 读取 |
|---|---|
| 浏览目录、查看文件、查询构建状态、下载 | [`by-knowledge-manager-read/SKILL.md`](by-knowledge-manager-read/SKILL.md) |
| 新建、重命名、删除、上传、更新、构建 | [`by-knowledge-manager-write/SKILL.md`](by-knowledge-manager-write/SKILL.md) |
| 语义检索、文件检索、元数据条件或 DSL 过滤 | [`by-knowledge-manager-search/SKILL.md`](by-knowledge-manager-search/SKILL.md) |
| 知识实体发现或补全 | [`by-knowledge-manager-entity/SKILL.md`](by-knowledge-manager-entity/SKILL.md) |

`KnowledgeEntity` 是知识库内的实体 Markdown 目录，不是本体对象库。涉及本体、对象类型或本体关系时不要使用本 Skill。

## 准备运行环境

使用安装了 `by-framework` 的 Python3 环境。

把 `argparse` 输出作为实时命令语法的唯一依据：

```bash
python3 <by-knowledge-manager目录>/scripts/by_knowledge_manager.py --help
python3 <by-knowledge-manager目录>/scripts/by_knowledge_manager.py <command> --help
```

统一使用以下调用形式：

```bash
python3 <by-knowledge-manager目录>/scripts/by_knowledge_manager.py <command> [options]
```

## 接收 knowledge-collection 入库交接单

当上游 `knowledge-collection` 返回 `action: "ingest-handoff"` 时，读取其 `handoff`，而不是自行扩大文件、知识库或目录范围。

- 使用 `handoff.target.resourceId`、`handoff.target.directoryPath` 和 `handoff.selection.files`；从上游已验证的正文产物取得对应本地文件。
- `handoff.manager.command=upload` 时执行 `upload`；`checkConflicts=true` 时按写入子 Skill 先检查冲突。
- 有 `confirmedOverwritePaths` 时重新验证冲突路径完全一致，再按文件逐一执行 `update-file`；不得接受部分确认。
- 返回管理器原始 JSON，使上游可依 `handoff.resultContract` 映射 `itemId`、上传路径和 build 受理状态；不能唯一映射时由上游记为 `unknown`。

## 遵守通用约束

- 操作前确定目标知识库。缺少 `resourceId` 时先询问，不要猜测。
- 搜索范围不明确时，确认搜索一个还是多个知识库；多个知识库重复传入 `--resource-id`。
- 原样保留知识库绝对路径，例如 `/`、`/产品资料`、`/产品资料/a.md`。
- 修改前需要校验参数时使用 `--dry-run`；删除和覆盖操作遵守变更子 Skill 的确认规则。
- 单资源请求自动携带 `X-BYCLAW-RESOURCE-ID`。多知识库检索没有唯一资源 ID，只在请求体传递 `resourceIdList`。
- 用自然语言汇报 CLI JSON，保留资源 ID、目录或文件路径、批次 ID、任务 ID、构建状态和检索命中定位信息。
- CLI 返回 `{ "ok": false, "error": "..." }` 时修正输入或环境；不得绕过 CLI 改调其他接口。
