# 字段结构说明（非结构化本体）

## 数据类型（data_type）

| 类型 | 说明 |
|------|------|
| `STRING` | 字符串 |
| `INTEGER` | 整数 |
| `FLOAT` | 浮点数 |
| `BOOLEAN` | 布尔值 |
| `DATE` | 日期 |

## 知识库绑定字段

| 字段 | 必填 | 说明 |
|------|------|------|
| `kb_id` | 是 | 知识库 ID，来自 `list_knowledge_bases.py` |
| `kb_directory` | 否 | 知识库目录路径，来自 `list_kb_directories.py`，默认 "/" |

## 字段结构示例

```json
{
    "property_code": "topic",
    "property_name": "主题",
    "data_type": "STRING",
    "ext_property": {
        "property_role_rule": {
            "property_role": "DIMENSION",
            "rule_type": "name"
        }
    }
}
```

## 关联关系（relations）

描述本对象与其他已有本体对象之间的语义关联，在 `create_object.py` 收集阶段传入。

| 字段              | 必填 | 说明 |
|-----------------|------|------|
| `relation_code` | 是 | 关系编码，英文下划线，如 `has_participant` |
| `relation_name` | 是 | 关系名称，如 `参会人` |
| `target_class`  | 是 | 目标对象编码，目标对象必须已在本体库中存在 |
| `relation_type` | 是 | 关系基数：`ONE_TO_ONE` / `ONE_TO_MANY` / `MANY_TO_ONE` / `MANY_TO_MANY` |
| `join_keys`     | 否 | 连接键数组，指定本对象与目标对象通过哪对属性关联，格式见下方示例 |

**关系基数说明：**

| 类型 | 含义 | 示例 |
|------|------|------|
| `ONE_TO_ONE` | 一对一 | 会议纪要 → 有唯一会议室 |
| `ONE_TO_MANY` | 一对多 | 会议纪要 → 有多个待办事项 |
| `MANY_TO_ONE` | 多对一 | 多份会议纪要 → 属于同一个项目 |
| `MANY_TO_MANY` | 多对多 | 会议纪要 ↔ 多个参会人 |

**关联关系结构示例：**

```json
{
    "relations": [
        {
            "relation_code": "has_participant",
            "relation_name": "参会人",
            "target_class": "by_employee",
            "relation_type": "MANY_TO_MANY",
            "join_keys": [
                {"sourceField": "employee_code", "targetField": "code"}
            ]
        },
        {
            "relation_code": "belongs_to_project",
            "relation_name": "所属项目",
            "target_class": "by_project",
            "relation_type": "MANY_TO_ONE",
            "join_keys": [
                {"sourceField": "project_id", "targetField": "id"}
            ]
        }
    ]
}
```

> **注意**：`target_class` 引用的对象必须已在本体库中存在。可通过 `list_resources.py` 查看已有对象列表，再填写对应编码。

## 与结构化本体的区别

- 非结构化本体不建表，数据来源是知识库文档
- `entity_source` 自动设置为 `KNOWLEDGE_BASE`
- 必须提供 `kb_id`（知识库 ID）
