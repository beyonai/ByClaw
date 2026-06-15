---
name: structured-ontology-manager
description: "对话式结构化个人本体管理：通过自然语言创建、删除个人结构化本体对象和视图，数据存储在个人 SQLite 中"
allowed-tools: execute, read_file
---

# 个人结构化本体管理

通过自然语言对话，管理结构化本体对象和视图。支持创建、删除操作，对象数据持久化到 SQLite。

## ⚡ 环境准备（首次执行时一次性完成）

> 以下步骤按顺序执行，**全部通过后才能调用脚本**。后续会话中若 `/tmp/ont_env` 存在且可执行则跳过。

### 第 1 步：安装 uv

```bash
export PATH="$HOME/.local/bin:$PATH"
which uv >/dev/null 2>&1 || curl -LsSf https://astral.sh/uv/install.sh | sh
```

> ⚠️ 不要用 `source ~/.bashrc`，沙箱可能不是 bash。

### 第 2 步：创建 Python 3.12 虚拟环境（必须在 /tmp）

```bash
export PATH="$HOME/.local/bin:$PATH"
[ -f /tmp/ont_env/bin/python ] || uv venv --python 3.12 --link-mode copy /tmp/ont_env
```

> ⚠️ **必须在 /tmp 下创建**，不要在工作目录（可能挂载在 fuseblk/S3，不支持 symlink）。`--link-mode copy` 是必需的。

### 第 3 步：安装依赖

```bash
export PATH="$HOME/.local/bin:$PATH"
uv pip install --python /tmp/ont_env/bin/python \
  by-datacloud \
  by-framework \
  -i https://mirrors.aliyun.com/pypi/simple/ \
  --extra-index-url https://pypi.org/simple/
```

> ⚠️ `by-datacloud`，`by-framework` 从公网 PyPI 安装（阿里云镜像可能没有）。必须加 `--extra-index-url https://pypi.org/simple/`。

### 第 4 步：验证环境就绪

```bash
/tmp/ont_env/bin/python -c "import by_framework; import by_datacloud; print('OK')"
```

如果输出 `OK` 则环境准备完成，否则根据报错排查。

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
export PATH="$HOME/.local/bin:$PATH"
export BE_DOMAINNAME=${BE_DOMAINNAME:-ByaiService}
cd /by/.openclaw/workspace-baiying-agent-10002987
/tmp/ont_env/bin/python skills/structured-ontology-manager/scripts/<script>.py '<JSON>'
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

| 用户表达 | 意图 | 脚本 | 入参示例 |
|----------|------|------|----------|
| 查看/列出 + 对象/视图 | 查询列表 | `list_resources.py` | `{}` 或 `{"resource_biz_type":"VIEW"}` |
| 创建/新建 + 对象（收集阶段） | 收集对象信息 | `create_object.py` | `{"action":"collect","entity_code":"xxx","entity_name":"xxx","entity_desc":"xxx","fields":[...]}` |
| 确认提交（对象） | 提交对象 | `create_object.py` | `{"action":"submit","entity_code":"xxx"}` |
| 创建/新建 + 视图（收集阶段） | 收集视图信息 | `create_view.py` | `{"action":"collect","view_code":"xxx","view_name":"xxx"}` |
| 确认提交（视图） | 提交视图 | `create_view.py` | `{"action":"submit","view_code":"xxx"}` |
| 删除 + 对象 | 删除对象 | `delete_object.py` | `{"entity_code":"xxx"}` |
| 删除 + 视图 | 删除视图 | `delete_view.py` | `{"view_code":"xxx"}` |
| 挂载/添加到助理/数字员工 | 挂载本体 | `mount_resource.py` | `{"agent_id":10004452,"resource_code":"xxx"}` |
| 查看术语类型 | 查枚举 | `list_term_types.py` | `{}` |
| 查看术语值 | 查枚举值 | `get_term_type_values.py` | `{"term_type_code":"xxx"}` |

## 字段说明

- `id` 字段由系统自动生成（INTEGER PRIMARY KEY AUTOINCREMENT），**不需要在 fields 中传入**
- `property_code` 不能为 `id`

## 参考文档

- [global-reference.md](references/global-reference.md) — 环境变量、认证、输出格式
- [intent-guide.md](references/intent-guide.md) — 意图路由和易混淆场景
- [field-rules.md](references/field-rules.md) — 字段类型与 role/rule_type 规则
- [error-codes.md](references/error-codes.md) — 错误码和调试流程
- [recovery-guide.md](references/recovery-guide.md) — 恢复闭环指南