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

## 对象使用领域（use_domain）

| 值 | 说明 | 示例 |
|----|------|------|
| `ods` | 直接采集、基本保持来源形态的原始对象 | 文章、文档、图片、视频、会议录音 |
| `ads` | 从原始内容中整理、抽取或归纳出的应用对象 | 从文章提取的产品、品牌、人物、事件 |

判断对象本身的来源，而不是内容主题：一篇谈论产品的文章属于 `ods`，从该文章整理出的产品对象属于 `ads`。仅支持 `ods` / `ads`，默认 `ads`；`create_object.py` 会将其写入外部 API 的 `ext_property.use_domain`。

向用户询问或推荐领域时，必须同时解释两种可选类型的用途；推荐时还要说明为何当前对象适合该类型，并允许用户改选。不得只展示 `ods/ads` 缩写或只给出推荐结果。

## 术语绑定（term_binding）

字段可通过以下方式绑定术语，以便在查询时按术语名称匹配、展示。

| 字段 | 说明 |
|------|------|
| `term_type_code` | 绑定已有术语类型（如 `user_name`），来自 `list_term_types.py` |
| `rel_term_codeorname` | 绑定方式：`code`（字段值是编码）或 `name`（字段值是名称），默认 `code` |
| `term_values` | 自定义枚举值列表，与 `term_type_code` **互斥，不能同时填写** |

> **注意**：通过 `relations` 关联了其他对象的字段，系统会自动将 `term_type_code` 设为对应的目标对象编码，无需手动填写。

### 常用系统术语类型

**绑定前先调 `list_term_types.py` 确认该类型在当前环境中存在。**

| `term_type_code` | 说明 | `rel_term_codeorname` 选择 | 典型适用字段 |
|------------------|------|---------------------------|-------------|
| `user_name` | 系统用户（员工） | `"code"` 字段存工号；`"name"` 字段存姓名 | 申请人、审批人、负责人等 |
| `dept_name` | 部门 / 机构 | `"code"` 字段存部门编码；`"name"` 字段存部门名称 | 所属部门、归属机构等 |

### 人员字段绑定示例

```json
{
    "property_code": "participant_code",
    "property_name": "参会人",
    "data_type": "STRING",
    "term_type_code": "user_name",
    "rel_term_codeorname": "code"
}
```

### 自定义枚举字段示例

```json
{
    "property_code": "meeting_type",
    "property_name": "会议类型",
    "data_type": "STRING",
    "term_values": ["周例会", "评审会", "启动会"]
}
```

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
| `target_object_code` | 是 | 目标对象在 collect 后返回并实际落库的最终编码，目标对象必须已在本体库中存在 |
| `relation_type` | 是 | 关系基数：`ONE_TO_ONE` / `ONE_TO_MANY` / `MANY_TO_ONE` / `MANY_TO_MANY` |
| `join_keys`     | 否 | 连接键数组，指定本对象与目标对象通过哪对属性关联，格式见下方示例 |
| `cascade_delete` | 否 | 严格 boolean；为 true 时删除目标 Owner 会展示当前 Dependent 的关联文件 |

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
            "target_object_code": "by_employee",
            "relation_type": "MANY_TO_MANY",
            "join_keys": [
                {"sourceField": "employee_code", "targetField": "code"}
            ]
        },
        {
            "relation_code": "belongs_to_project",
            "relation_name": "所属项目",
            "target_object_code": "by_project",
            "relation_type": "MANY_TO_ONE",
            "join_keys": [
                {"sourceField": "project_id", "targetField": "id"}
            ],
            "cascade_delete": true
        }
    ]
}
```

> **注意**：collect 可能在入参对象编码后追加随机数，因此 `target_object_code` 必须使用 collect 后返回并实际落库的最终编码，不得使用 collect 入参中的原始对象编码。优先采用 collect 响应返回的编码；无法确认时，必须通过 `list_resources.py` 查询并采用库中记录的编码。例如 collect 入参为 `Product`，响应或对象列表显示为 `Product_8472`，则填写 `Product_8472`。
> 有 `join_keys` 的关联字段（如 `employee_code`、`project_id`），系统会自动将其 `term_type_code` 绑定为对应的目标对象编码，无需手动填写。

### 级联删除固定语义

- 当前对象是 Dependent，`target_object_code` 指向 Owner。
- `cascade_delete: true` 只允许 `MANY_TO_ONE` 或 `ONE_TO_ONE`。
- 删除 Owner：发现实际关联文件后弹出表单，用户可逐个选择是否删除。
- 取消删除某个 Dependent：保留文件、清空其 source join key 并解除关系；不提供重新关联。
- 删除 Dependent：不删除 Owner。
- source join key 必须存在且允许清空，不能是不可清空的业务主键。
- 不创建反向关系，不接受 `inverse`、`lifecycle` 或其他所有权策略字段。

## 与结构化本体的区别

- 非结构化本体不建表，数据来源是知识库文档
- `entity_source` 自动设置为 `KNOWLEDGE_BASE`
- 必须提供 `kb_id`（知识库 ID）
