# 字段类型规则（DIMENSION/MEASURE）

## 数据类型（data_type）

| 类型 | SQLite 映射 | 说明 |
|------|-------------|------|
| `STRING` | `TEXT` | 字符串 |
| `INTEGER` | `INTEGER` | 整数 |
| `FLOAT` | `REAL` | 浮点数 |
| `BOOLEAN` | `INTEGER` | 布尔值（0/1） |
| `DATE` | `TEXT` | 日期（ISO 8601） |

## 属性角色（property_role）

| 角色 | 说明 |
|------|------|
| `DIMENSION` | 维度属性，用于过滤、分组 |
| `MEASURE` | 度量属性，用于计算、聚合 |

## rule_type 合法组合

| property_role | rule_type | 说明 |
|---------------|-----------|------|
| `DIMENSION` | `name` | 名称维度（作为对象的主标识） |
| `DIMENSION` | `description` | 描述维度 |
| `DIMENSION` | `status` | 状态维度 |
| `DIMENSION` | `category` | 分类维度 |
| `DIMENSION` | `date` | 日期维度 |
| `DIMENSION` | `link` | 链接维度 |
| `MEASURE` | `amount` | 金额度量 |
| `MEASURE` | `count` | 数量度量 |
| `MEASURE` | `rate` | 比率度量 |
| `MEASURE` | `primary_key` | 主键（仅 id 字段） |

## 术语绑定（term_binding）

- `term_type_code`：绑定已有术语类型（如 `user_name`），来自 `list_term_types.py`
- `rel_term_codeorname`：绑定方式，`code`（按编码匹配）或 `name`（按名称匹配），默认 `code`
- `term_values`：自定义枚举值列表，与 `term_type_code` 互斥

注意：`term_type_code` 和 `term_values` 不能同时填写。

## 字段结构示例

```json
{
    "property_code": "handler_name",
    "property_name": "处理人",
    "data_type": "STRING",
    "ext_property": {
        "property_role_rule": {
            "property_role": "DIMENSION",
            "rule_type": "name"
        }
    },
    "term_type_code": "user_name",
    "rel_term_codeorname": "name"
}
```
