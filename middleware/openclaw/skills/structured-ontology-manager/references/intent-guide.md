# 意图路由和易混淆场景

## 意图路由表

| 用户表达 | 意图 | 调用脚本 | 入参 action |
|----------|------|----------|-------------|
| 查看/列出 + 对象/视图 | 查询列表 | `list_resources.py` | — |
| 创建/新建 + 对象 | 收集对象信息 | `create_object.py` | `collect` |
| 确认提交（对象） | 提交对象 | `create_object.py` | `submit` |
| 创建/新建 + 视图 | 收集视图信息 | `create_view.py` | `collect` |
| 确认提交（视图） | 提交视图 | `create_view.py` | `submit` |
| 删除 + 对象 | 删除对象 | `delete_object.py` | — |
| 删除 + 视图 | 删除视图 | `delete_view.py` | — |
| 查看术语类型 | 查枚举类型 | `list_term_types.py` | — |
| 查看术语值 | 查枚举值 | `get_term_type_values.py` | — |

## 二次确认场景

- **删除对象**：提示"将同时删除本体定义和 SQLite 表，此操作不可逆，确认删除？"
- **删除视图**：提示"将删除视图定义，确认删除？"

## 多轮对话信息收集

1. 首次调用 `create_object.py collect`，传入 `entity_code`（必填）
2. 根据返回的 `missing` 字段，追问用户补充信息
3. 用户补充后，再次调用 `create_object.py collect`，传入新增字段
4. 重复直到 `missing` 为空
5. 向用户展示完整信息，请求确认
6. 用户确认后，调用 `create_object.py submit`

## 易混淆场景

- **"修改对象"**：当前版本不支持修改，引导用户先删除再重建
- **"查看对象详情"**：调用 `list_resources.py` 后，可进一步调用门户服务 `queryResourceDetail`
- **"结构化 vs 非结构化"**：本 Skill 仅处理结构化（SQLite 表），非结构化请使用 `unstructured-ontology-manager`
