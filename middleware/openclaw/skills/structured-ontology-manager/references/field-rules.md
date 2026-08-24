# 字段类型规则（DIMENSION/MEASURE）

## 数据类型（data_type）

| 类型 | 表 映射      | 说明 |
|------|-----------|------|
| `STRING` | `TEXT`    | 字符串 |
| `INTEGER` | `INTEGER` | 整数 |
| `FLOAT` | `REAL`    | 浮点数 |
| `BOOLEAN` | `INTEGER` | 布尔值（0/1） |
| `DATE` | `TEXT`    | 日期（ISO 8601） |

## 术语同步字段与对象关联一致性

- 每个实体对象都由平台自动生成系统主键 `id`。不要在 `fields` 中重复创建 `id`，也不要把业务字段标成系统主键。
- 业务标识使用 `*_code`、`*_no` 或明确业务名称，例如 `event_code`、`employee_code`、`application_no`。
- 父对象实际生效的 `term_sync.term_code_field` 是对象型 LIST_TERM 关联键的唯一事实来源；缺失或空值时默认 `id`。
- 子对象关系目标字段必须等于 `term_code_field`，关联字段和 Action 参数的数据类型必须与该父字段一致，下拉返回的术语 code 必须原值落库。
- `term_code_field=id` 时，子对象通常使用 `<relation>_id` + `INTEGER`，Action 使用 `select_by_id(int(value))`。
- `term_code_field=<business_field>` 时，子对象字段和 Action 参数使用该业务字段类型，Action 使用 `Q.eq(Parent.F.<business_field>, value)`。
- 禁止术语同步用 `id`、关系或 Action 却使用 `event_code`；也禁止术语同步用业务字段、Action 却调用 `select_by_id`。

> `user_name`、`dept_name` 等系统术语有自己的 code/name 语义，不属于上述对象型 LIST_TERM；仍按术语定义选择工号、姓名、部门编码或部门名称。

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
> 对象关联场景使用 `"code"`，实际保存值由父对象 `term_sync.term_code_field` 决定；默认保存系统 `id`，显式配置业务字段时保存该字段值。

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
