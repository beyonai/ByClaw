---
name: 个人非结构化本体管理
description: "对话式非结构化个人本体管理：通过自然语言创建、删除个人非结构化本体对象，数据来源绑定知识库目录"
allowed-tools: execute, read_file
---

# 个人非结构化本体管理

通过自然语言对话，管理非结构化本体对象。支持创建、删除操作，对象绑定知识库目录（不建 SQLite 表）。

## 能力范围

- 查询已有本体对象列表
- 查询个人知识库列表
- 查询知识库目录列表
- 创建非结构化本体对象（含字段、知识库绑定）
- 删除非结构化本体对象（不删知识库）
- 挂载本体到当前数字员工/个人助理
- 查询可绑定的术语类型
- 查询术语类型的值列表

## 与结构化本体的区别

| 维度 | structured-ontology-manager | unstructured-ontology-manager |
|------|-----------------------------|---------------------------------|
| 数据来源 | SQLite 动态表 | 知识库目录文档 |
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

| 用户表达 | 意图 | 调用脚本 |
|----------|------|----------|
| 查看/列出 + 对象 | 查询列表 | `scripts/list_resources.py` |
| 查看知识库 | 查询知识库 | `scripts/list_knowledge_bases.py` |
| 查看目录 | 查询目录 | `scripts/list_kb_directories.py` |
| 创建/新建 + 对象 | 收集对象信息 | `scripts/create_object.py collect` |
| 确认提交 | 提交对象 | `scripts/create_object.py submit` |
| 删除 + 对象 | 删除对象 | `scripts/delete_object.py` |
| 挂载/添加到助理/数字员工 | 挂载本体 | `scripts/mount_resource.py` |
| 查看术语类型 | 查枚举 | `scripts/list_term_types.py` |
| 查看术语值 | 查枚举值 | `scripts/get_term_type_values.py` |

## 字段说明

- `kb_id`：知识库编码，必须使用 `list_knowledge_bases.py` 返回的 **`resourceCode`** 字段，**不是 `resourceId`**
  - 示例：`resourceCode: "16"`（不是 `resourceId: "10000765"`）
- `kb_directory`：知识库目录路径，来自 `list_kb_directories.py` 返回的 `directoryPath` 字段

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
