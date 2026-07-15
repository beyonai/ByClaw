---
name: unstructured-ontology-manager
description: 管理知识库中非结构化内容（文档、图片、视频）的本体对象——给非结构化内容打上可查询的结构化标签（字段如日期、主题、参会人），实现结构化与非结构化内容的融合检索。内容存于知识库目录，不建动态表。支持以下能力：查询本体对象详情及属性、查询/创建/删除非结构化本体对象、查询个人知识库列表、查询知识库目录列表、挂载本体对象到助理/数字员工、按对象属性搜索关联术语（支持关键字过滤）、查询可绑定的术语类型及值列表、在知识库中创建目录/文件夹。典型对话：「帮我创建一个会议纪要对象绑定到会议知识库」「查看我有哪些非结构化本体对象」「我的周报存知识库里，想按日期和项目名检索」「查看我的知识库有哪些」「把会议纪要对象挂载到我的助理」「查某属性绑定了哪些术语」。
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

- 查询本体对象详情（含属性及术语绑定信息）
- 按对象属性搜索关联术语（支持关键字过滤）
- 查询已有本体对象列表
- 查询个人知识库列表
- 查询知识库目录列表
- 创建非结构化本体对象（含字段、知识库绑定、对象间关联关系）
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

### 创建对象的信息收集步骤

收集基本信息（对象名称、编码、描述、知识库、目录、字段）后，**必须额外询问以下三个可选配置**，不得跳过：

1. **是否需要绑定模板文件？**
   - 若是，请用户提供模板文件路径（`template_file_path`），用于指定该对象的解析/提取模板
   - 若否，`template_file_path` 留空

2. **是否需要绑定规则文件？**
   - 若是，请用户提供规则文件路径（`rules_file_path`），用于指定该对象的处理规则
   - 若否，`rules_file_path` 留空

3. **是否需要定义与其他对象的关联关系？**
   - 若是，向用户收集每条关系的以下信息，允许添加多条：
     - `relation_code`：关系编码（英文下划线，如 `has_participant`）
     - `relation_name`：关系名称（如 `参会人`）
     - `target_entity_code`：目标对象编码（目标对象必须已在本体库中存在，可先通过"查看本体对象列表"确认）
     - `relation_type`：关系基数，从以下选项中选择：
       - `ONE_TO_ONE`：一对一
       - `ONE_TO_MANY`：一对多
       - `MANY_TO_ONE`：多对一
       - `MANY_TO_MANY`：多对多
     - `join_keys`：连接键，指定本对象的哪个属性与目标对象的哪个属性关联，格式为：
       `[{"from_field": "<本对象属性编码>", "to_field": "<目标对象属性编码>"}]`
       例：本对象有 `employee_code` 字段，目标对象 `by_employee` 有 `code` 字段，则填 `[{"from_field": "employee_code", "to_field": "code"}]`
   - 若否，`relations` 传空数组 `[]`

确认以上信息无误后，再执行收集阶段脚本。

## 意图路由

每条意图对应一条 Bash 命令，**直接执行，不得改写**：

| 用户表达 | Bash 命令（在 skill 根目录执行）                                                                                                                                                                                                                                                                                                                            |
|----------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 查询对象详情 / 查看对象有哪些属性 | `/usr/local/bin/python3 scripts/get_object.py '{"object_code":"<对象编码>"}'`                                                                                                                                                                                                                                                                         |
| 查某属性绑定了哪些术语 | `/usr/local/bin/python3 scripts/search_property_terms.py '{"object_code":"<对象编码>","property_code":"<属性编码>"}'`                                                                                                                                                                                                                                     |
| 在某属性的术语中搜索关键字 | `/usr/local/bin/python3 scripts/search_property_terms.py '{"object_code":"<对象编码>","property_code":"<属性编码>","keyword":"<关键字>"}'`                                                                                                                                                                                                                   |
| 查看/列出 + 对象 | `/usr/local/bin/python3 scripts/list_resources.py '{}'`                                                                                                                                                                                                                                                                                           |
| 查看知识库列表 | `/usr/local/bin/python3 scripts/list_knowledge_bases.py '{}'`                                                                                                                                                                                                                                                                                     |
| 查看知识库目录 | `/usr/local/bin/python3 scripts/list_kb_directories.py '{"kb_id":"<kb_id>"}'`                                                                                                                                                                                                                                                                     |
| 创建/新建 + 对象（收集阶段） | `/usr/local/bin/python3 scripts/create_object.py '{"action":"collect","entity_code":"<code>","entity_name":"<name>","entity_desc":"<entity_desc>","kb_resource_id":"<resourceId>","kb_id": "<resourceCode>", "kb_directory":"<dir>","fields":[],"relations":[{"relation_code":"<rel_code>","relation_name":"<rel_name>","target_entity_code":"<target_code>","relation_type":"<ONE_TO_ONE|ONE_TO_MANY|MANY_TO_ONE|MANY_TO_MANY>"}],"session_id":"<sid>","template_file_path":"<path_or_empty>","rules_file_path":"<path_or_empty>"}'` |
| 确认提交 | `/usr/local/bin/python3 scripts/create_object.py '{"action":"submit","entity_code":"<code>","session_id":"<sid>"}'`                                                                                                                                                                                                                               |
| 删除 + 对象 | `/usr/local/bin/python3 scripts/delete_object.py '{"entity_code":"<code>"}'`                                                                                                                                                                                                                                                                      |
| 挂载/添加到助理/数字员工 | `/usr/local/bin/python3 scripts/mount_resource.py '{"agent_id":<id>,"resource_code":"<code>"}'`                                                                                                                                                                                                                                                   |
| 查看术语类型 | `/usr/local/bin/python3 scripts/list_term_types.py '{}'`                                                                                                                                                                                                                                                                                          |
| 创建目录/文件夹 | `/usr/local/bin/python3 scripts/create_directory.py '{"resource_id":"<resourceId>","directory_name":"<name>"}'`                                                                                                                                                                                                                                   |
| 查看术语值 | `/usr/local/bin/python3 scripts/get_term_type_values.py '{"term_type_code":"<code>"}'`                                                                                                                                                                                                                                                            |

**输出处理规则**：
- `{"ok": true, ...}` → 操作成功，向用户展示 `data` 中的关键信息
- `{"ok": false, "error": "..."}` → 操作失败，将 `error` 原文告知用户，**不要猜测原因或自行重试**
- `{"ok": true, "missing": [...]}` → 收集阶段还缺字段，根据 `missing` 列表向用户追问，**不要尝试填充默认值**

> `kb_id` 必须来自 `list_knowledge_bases.py` 返回的 **`resourceCode`** 字段（如 `"16"`），不是 `resourceId`

## 字段说明

- `kb_resource_id`：知识库资源 ID（必填），来自 `list_knowledge_bases.py` 返回的 **`resourceId`** 字段（如 `"10000765"`）。
- `kb_id`：知识库资源 编码（必填），来自 `list_knowledge_bases.py` 返回的 **`resourceCode`** 字段（如 `"59"`）。
- `kb_directory`：知识库目录路径，来自 `list_kb_directories.py` 返回的 `directoryPath` 字段
- `resource_id`：创建目录时使用，来自 `list_knowledge_bases.py` 返回的 **`resourceId`** 字段（如 `"10000765"`），**不是 `resourceCode`**
- `directory_name`：要创建的目录或文件夹名称
- `template_file_path`：可选，模板文件路径；不为空时脚本通过外部接口读取文件内容，以 `template` 为键写入 `ext_property` 传给 API，若读取内容为空则报错终止
- `rules_file_path`：可选，规则文件路径；不为空时脚本通过外部接口读取文件内容，以 `rules` 为键写入 `ext_property` 传给 API，若读取内容为空则报错终止
- `relations`：可选，对象间关联关系数组；每条关系包含以下五个字段：
  - `relation_code`：关系编码（英文下划线，如 `has_participant`）
  - `relation_name`：关系名称（如 `参会人`）
  - `target_entity_code`：目标对象编码，**目标对象必须已在本体库中存在**，可先通过查看对象列表确认
  - `relation_type`：关系基数，可选值 `ONE_TO_ONE` / `ONE_TO_MANY` / `MANY_TO_ONE` / `MANY_TO_MANY`
  - `join_keys`：连接键数组，指定本对象与目标对象通过哪对属性关联，格式 `[{"from_field": "<本对象属性编码>", "to_field": "<目标对象属性编码>"}]`

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
