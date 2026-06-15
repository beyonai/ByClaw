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

## 与结构化本体的区别

- 非结构化本体不建 SQLite 表，数据来源是知识库文档
- `entity_source` 自动设置为 `KNOWLEDGE_BASE`
- 必须提供 `kb_id`（知识库 ID）
