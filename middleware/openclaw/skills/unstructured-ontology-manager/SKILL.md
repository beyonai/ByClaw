---
name: unstructured-ontology-manager
description: 当你有文档、图片、视频等非结构化内容存在知识库里，想让 Agent 能像查结构化数据一样精准检索和操作它们时使用本技能。它能够帮你给非结构化内容打上结构化标签（定义字段，如日期、主题、参会人），让每份文档/图片/视频都带有可查询的属性，实现结构化数据与非结构化内容的融合检索。定义的标签字段相当于表的字段，支持新增、修改、删除操作。与结构化本体的区别在于：内容本身存在知识库里，而不是动态表。你可以通过以下对话唤起本技能：「帮我创建一个会议纪要对象，绑定到我的会议知识库」「我的周报存在知识库里，想让 Agent 能按日期和项目名检索」「查看我的知识库有哪些」「把会议纪要对象挂载到我的助理」。
allowed-tools: execute, read_file
---

# 个人非结构化本体管理

通过自然语言对话，管理非结构化本体对象。支持创建、删除操作，对象绑定知识库目录（不建表）。

## ⚠️ 执行规则（最高优先级，不得违反）

1. **必须直接执行脚本**，禁止自行编写任何 Python/Shell 代码来替代或模拟脚本功能
2. **禁止重写脚本逻辑**：即使你能理解脚本内容，也不允许复现、改写或内联其逻辑
3. **所有操作通过 Bash 调用已有脚本完成**，脚本路径见下方意图路由表
4. **解析脚本输出**：读取脚本 stdout 的 JSON，`ok: true` 为成功，`ok: false` 为失败，失败时将 `error` 字段内容告知用户
5. **不允许推测结果**：脚本未执行前不得告知用户操作成功或失败

## 能力范围

- 查询已有本体对象列表
- 查询个人知识库列表
- 查询知识库目录列表
- 创建非结构化本体对象（含字段、知识库绑定）
- 删除非结构化本体对象（不删知识库）
- 挂载本体到当前数字员工/个人助理
- 查询可绑定的术语类型
- 在知识库中创建目录或文件夹
- 查询术语类型的值列表

## 与结构化本体的区别

| 维度 | structured-ontology-manager | unstructured-ontology-manager |
|------|----------------------------|---------------------------------|
| 数据来源 | 动态表 | 知识库目录文档 |
| `entity_source` | `DYNAMIC_TABLE` | `KNOWLEDGE_BASE` |
| 额外操作 | 建表/删表 | 绑定 `kb_id` + `kb_directory` |
| 视图支持 | ✅ | ❌ |

## 使用示例

- "帮我创建一个会议纪要对象，绑定到我的会议知识库"
- "查看我有哪些非结构化本体对象"
- "删除会议纪要对象"
- "我的知识库有哪些？"
- "把会议纪要对象挂载到我的助理"

## 核心流程

用户意图 → 意图识别 → 信息收集（多轮对话）→ 用户确认 → 执行

## 意图路由

每条意图对应一条 Bash 命令，**直接执行，不得改写**：

| 用户表达 | Bash 命令（在 skill 根目录执行） |
|----------|--------------------------------|
| 查看/列出 + 对象 | `/usr/local/bin/python3 scripts/list_resources.py '{}'` |
| 查看知识库列表 | `/usr/local/bin/python3 scripts/list_knowledge_bases.py '{}'` |
| 查看知识库目录 | `/usr/local/bin/python3 scripts/list_kb_directories.py '{"kb_id":"<kb_id>"}'` |
| 创建/新建 + 对象（收集阶段） | `/usr/local/bin/python3 scripts/create_object.py '{"action":"collect","entity_code":"<code>","entity_name":"<name>","kb_id":"<resourceCode>","kb_directory":"<dir>","fields":[]},"session_id":"<sid>"'` |
| 确认提交 | `/usr/local/bin/python3 scripts/create_object.py '{"action":"submit","entity_code":"<code>","session_id":"<sid>"}'` |
| 删除 + 对象 | `/usr/local/bin/python3 scripts/delete_object.py '{"entity_code":"<code>"}'` |
| 挂载/添加到助理/数字员工 | `/usr/local/bin/python3 scripts/mount_resource.py '{"agent_id":<id>,"resource_code":"<code>"}'` |
| 查看术语类型 | `/usr/local/bin/python3 scripts/list_term_types.py '{}'` |
| 创建目录/文件夹 | `/usr/local/bin/python3 scripts/create_directory.py '{"resource_id":"<resourceId>","directory_name":"<name>"}'` |
| 查看术语值 | `/usr/local/bin/python3 scripts/get_term_type_values.py '{"term_type_code":"<code>"}'` |

**输出处理规则**：
- `{"ok": true, ...}` → 操作成功，向用户展示 `data` 中的关键信息
- `{"ok": false, "error": "..."}` → 操作失败，将 `error` 原文告知用户，**不要猜测原因或自行重试**
- `{"ok": true, "missing": [...]}` → 收集阶段还缺字段，根据 `missing` 列表向用户追问，**不要尝试填充默认值**

> `kb_id` 必须来自 `list_knowledge_bases.py` 返回的 **`resourceCode`** 字段（如 `"16"`），不是 `resourceId`

## 字段说明

- `kb_id`：知识库编码，必须使用 `list_knowledge_bases.py` 返回的 **`resourceCode`** 字段，**不是 `resourceId`**
  - 示例：`resourceCode: "16"`（不是 `resourceId: "10000765"`）
- `kb_directory`：知识库目录路径，来自 `list_kb_directories.py` 返回的 `directoryPath` 字段
- `resource_id`：创建目录时使用，来自 `list_knowledge_bases.py` 返回的 **`resourceId`** 字段（如 `"10000765"`），**不是 `resourceCode`**
- `directory_name`：要创建的目录或文件夹名称

## 认证与环境变量

| 变量 | 用途 |
|------|------|
| `BE_DOMAINNAME` | 服务发现，门户服务名称 |
| `BEYOND_TOKEN` | 门户服务 API 认证 |
| `ONTOLOGY_STORE` | 暂存后端：`redis`（默认）或 `local` |
| `ONTOLOGY_REDIS_HOST` | Redis 主机（默认 localhost） |
| `DATACLOUD_GATEWAY_REDIS_HOST` | 服务发现 Redis 主机 |

## 参考文档

- [global-reference.md](references/global-reference.md) — 环境变量、认证、输出格式
- [field-rules.md](references/field-rules.md) — 字段结构说明
