# 字段类型规则（DIMENSION/MEASURE）

## 数据类型（data_type）

| 类型 | 表 映射      | 说明 |
|------|-----------|------|
| `STRING` | `TEXT`    | 字符串 |
| `INTEGER` | `INTEGER` | 整数 |
| `FLOAT` | `REAL`    | 浮点数 |
| `BOOLEAN` | `INTEGER` | 布尔值（0/1） |
| `DATE` | `TEXT`    | 日期（ISO 8601） |

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

## 常用系统术语类型

以下是系统内置的标准术语类型，可直接绑定，无需自定义枚举值。**绑定前先调 `list_term_types.py` 确认该类型在当前环境中存在。**

| `term_type_code` | 说明 | `rel_term_codeorname` 选择 | 典型适用字段 |
|------------------|------|---------------------------|-------------|
| `user_name` | 系统用户（员工） | `"code"` 字段存工号；`"name"` 字段存姓名 | 申请人、审批人、负责人、处理人、创建人等 |
| `dept_name` | 部门 / 机构 | `"code"` 字段存部门编码；`"name"` 字段存部门名称 | 所属部门、申请部门、归属机构等 |

> `rel_term_codeorname: "code"` — 字段值是编码（如工号 `EMP001`、部门编码 `D003`），系统按编码匹配术语，展示时显示对应名称。
> `rel_term_codeorname: "name"` — 字段值直接是名称（如 `张三`、`研发部`），按名称匹配。
> 外键场景（字段存另一对象的 `id`）通常用 `"code"`，配合父表的 `term_sync` 联动。

### 人员字段绑定示例

字段存工号（工号 → 匹配用户，界面显示姓名）：

```json
{
  "property_code": "applicant_code",
  "property_name": "申请人",
  "data_type": "STRING",
  "ext_property": {"property_role_rule": {"property_role": "DIMENSION", "rule_type": "name"}},
  "term_type_code": "user_name",
  "rel_term_codeorname": "code"
}
```

字段存姓名（直接按姓名匹配用户）：

```json
{
  "property_code": "approver_name",
  "property_name": "审批人",
  "data_type": "STRING",
  "ext_property": {"property_role_rule": {"property_role": "DIMENSION", "rule_type": "name"}},
  "term_type_code": "user_name",
  "rel_term_codeorname": "name"
}
```

### 部门字段绑定示例

```json
{
  "property_code": "dept_code",
  "property_name": "所属部门",
  "data_type": "STRING",
  "ext_property": {"property_role_rule": {"property_role": "DIMENSION", "rule_type": "category"}},
  "term_type_code": "dept_name",
  "rel_term_codeorname": "code"
}
```

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
