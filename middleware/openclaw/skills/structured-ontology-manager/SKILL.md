---
name: structured-ontology-manager
description: 当你想让 Agent 查询或操作你自己定义的业务数据（而不是系统内置数据）时使用本技能。它能够帮你用自然语言定义一张新的数据表，并基于这张表开发出本体对象，设定字段和字段含义，数据自动存入专属 SQLite；还能创建跨表视图，让 Agent 同时查询多个对象。定义完成后挂载到当前数字员工，Agent 就能直接查询和操作你的数据了。你可以通过以下对话唤起本技能：「帮我创建一个任务管理对象」「我想建一个拜访记录表，包含客户名、拜访日期、跟进结果」「查看我有哪些本体对象」「把任务对象挂载到我的助理」。
---

# 个人结构化本体管理

通过自然语言对话，管理结构化本体对象和视图。支持创建、删除操作，对象数据持久化到 SQLite。

## ⚠️ 执行规则（最高优先级，不得违反）

1. **必须直接执行脚本**，禁止自行编写任何 Python/Shell 代码来替代或模拟脚本功能
2. **禁止重写脚本逻辑**：即使你能理解脚本内容，也不允许复现、改写或内联其逻辑
3. **所有操作通过 Bash 调用已有脚本完成**，脚本路径见下方意图路由表
4. **解析脚本输出**：读取脚本 stdout 的 JSON，`ok: true` 为成功，`ok: false` 为失败，失败时将 `error` 字段内容告知用户
5. **不允许推测结果**：脚本未执行前不得告知用户操作成功或失败

## 🌐 必需环境变量

以下变量由运行环境自动注入，脚本会自动读取。**调用脚本前确认存在**，缺失则报错提示用户：

| 变量 | 是否必需 | 默认值 | 说明 |
|------|----------|--------|------|
| `BEYOND_TOKEN` | ✅ 必需 | 无 | 门户服务认证 Token |
| `USER_CODE` | ✅ 必需 | 无 | 当前用户编码 |
| `BE_DOMAINNAME` | ✅ 必需 | `ByaiService` | 门户服务名称 |
| `REDIS_HOST` | ✅ 必需 | 无 | Redis 主机 |
| `REDIS_PORT` | ✅ 必需 | `6379` | Redis 端口 |
| `REDIS_PASSWORD` | ✅ 必需 | 无 | Redis 密码 |
| `OPENCLAW_GATEWAY_TOKEN` | ❌ 可选 | 无 | SQLite 服务认证 |

> 快速检查：`env | grep -E 'BEYOND_TOKEN|USER_CODE|BE_DOMAINNAME|REDIS_HOST'`

## 🚀 调用脚本

环境就绪后，所有脚本统一调用方式：

```bash
/usr/local/bin/python3 <script>.py '<JSON>'
```

> JSON 参数作为第一个命令行参数传入，所有输出为 JSON（stdout）。

## 能力范围

- 查询已有本体对象/视图列表
- 创建本体对象（含字段、术语绑定）
- 创建本体视图（含对象关联关系）
- 删除本体对象（含删表）
- 删除本体视图
- 挂载本体到当前数字员工/个人助理
- 查询可绑定的术语类型
- 查询术语类型的值列表

## 使用示例

- "帮我创建一个任务管理对象，包含标题、处理人、状态字段"
- "创建一个任务视图，关联任务对象和用户对象"
- "查看我有哪些本体对象"
- "删除任务管理对象"
- "有哪些可用的术语类型？"
- "把任务管理对象挂载到我的助理"

## 核心流程

用户意图 → 意图识别 → 信息收集（多轮对话）→ 用户确认 → 执行

## 意图路由

每条意图对应一条 Bash 命令，**直接执行，不得改写**：

| 用户表达 | Bash 命令（在 skill 根目录执行） |
|----------|--------------------------------|
| 查看/列出 + 对象 | `/usr/local/bin/python3 scripts/list_resources.py '{}'` |
| 查看/列出 + 视图 | `/usr/local/bin/python3 scripts/list_resources.py '{"resource_biz_type":"VIEW"}'` |
| 创建/新建 + 对象（收集阶段） | `/usr/local/bin/python3 scripts/create_object.py '{"action":"collect","entity_code":"<code>","entity_name":"<name>","entity_desc":"<desc>","fields":[...],"session_id":"<sid>"}'` |
| 确认提交（对象） | `/usr/local/bin/python3 scripts/create_object.py '{"action":"submit","entity_code":"<code>","session_id":"<sid>"}'` |
| 创建/新建 + 视图（收集阶段） | `/usr/local/bin/python3 scripts/create_view.py '{"action":"collect","view_code":"<code>","view_name":"<name>","object_codes":[...]}',"session_id":"<sid>"` |
| 确认提交（视图） | `/usr/local/bin/python3 scripts/create_view.py '{"action":"submit","view_code":"<code>","session_id":"<sid>"}'` |
| 删除 + 对象 | `/usr/local/bin/python3 scripts/delete_object.py '{"entity_code":"<code>"}'` |
| 删除 + 视图 | `/usr/local/bin/python3 scripts/delete_view.py '{"view_code":"<code>"}'` |
| 挂载/添加到助理/数字员工 | `/usr/local/bin/python3 scripts/mount_resource.py '{"agent_id":<id>,"resource_code":"<code>"}'` |
| 查看术语类型 | `/usr/local/bin/python3 scripts/list_term_types.py '{}'` |
| 查看术语值 | `/usr/local/bin/python3 scripts/get_term_type_values.py '{"term_type_code":"<code>"}'` |

**输出处理规则**：
- `{"ok": true, ...}` → 操作成功，向用户展示 `data` 中的关键信息
- `{"ok": false, "error": "..."}` → 操作失败，将 `error` 原文告知用户，**不要猜测原因或自行重试**
- `{"ok": true, "missing": [...]}` → 收集阶段还缺字段，根据 `missing` 列表向用户追问，**不要尝试填充默认值**

## 字段说明

- `id` 字段由系统自动生成（INTEGER PRIMARY KEY AUTOINCREMENT），**不需要在 fields 中传入**
- `property_code` 不能为 `id`

## 参考文档

- [global-reference.md](references/global-reference.md) — 环境变量、认证、输出格式
- [intent-guide.md](references/intent-guide.md) — 意图路由和易混淆场景
- [field-rules.md](references/field-rules.md) — 字段类型与 role/rule_type 规则
- [error-codes.md](references/error-codes.md) — 错误码和调试流程
- [recovery-guide.md](references/recovery-guide.md) — 恢复闭环指南
