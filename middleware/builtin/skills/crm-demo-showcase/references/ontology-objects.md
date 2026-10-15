# 本体对象定义

本文档定义 CRM 演示场景所需的本体对象、字段结构、Mock 数据及脚本调用规范。

---

## 一、结构化本体

### 1.1 产品对象（product）

创建产品对象，存储产品基础信息。

| 字段 | 值 |
|------|-----|
| `entity_code` | `product` |
| `entity_name` | 产品 |
| `entity_desc` | CRM 产品信息管理 |
| `entity_source` | `DYNAMIC_TABLE` |

**字段定义：**

| property_code | property_name | data_type | property_role | rule_type | 说明 |
|---------------|---------------|-----------|---------------|-----------|------|
| `product_code` | 产品编码 | `STRING` | `DIMENSION` | `id` | 产品唯一编码 |
| `product_name` | 产品名称 | `STRING` | `DIMENSION` | `name` | 产品显示名称 |
| `category` | 产品分类 | `STRING` | `DIMENSION` | `name` | 产品所属类别 |
| `status` | 产品状态 | `STRING` | `DIMENSION` | `name` | 在售/停售/预研 |
| `unit_price` | 单价 | `FLOAT` | `MEASURE` | `raw_number` | 标准单价（元） |

### 1.2 订单对象（order）

创建订单对象，通过 `product_code` 关联产品。

| 字段 | 值 |
|------|-----|
| `entity_code` | `order` |
| `entity_name` | 订单 |
| `entity_desc` | CRM 订单记录管理 |
| `entity_source` | `DYNAMIC_TABLE` |

**字段定义：**

| property_code | property_name | data_type | property_role | rule_type | 说明 |
|---------------|---------------|-----------|---------------|-----------|------|
| `order_code` | 订单编码 | `STRING` | `DIMENSION` | `id` | 订单唯一编码 |
| `order_name` | 订单名称 | `STRING` | `DIMENSION` | `name` | 订单显示名称 |
| `product_code` | 产品编码 | `STRING` | `DIMENSION` | `id` | 关联产品编码 |
| `customer_name` | 客户名称 | `STRING` | `DIMENSION` | `name` | 下单客户 |
| `order_date` | 下单日期 | `DATE` | `DIMENSION` | `date` | 订单创建日期 |
| `status` | 订单状态 | `STRING` | `DIMENSION` | `name` | 待处理/已完成/已取消 |
| `quantity` | 数量 | `INTEGER` | `MEASURE` | `raw_number` | 购买数量 |
| `total_amount` | 订单金额 | `FLOAT` | `MEASURE` | `raw_number` | 订单总金额（元） |

### 1.3 产品订单视图（product_order_view）

创建视图，关联产品与订单两个对象，按产品汇总订单数据。

| 字段 | 值 | 说明 |
|------|-----|------|
| `view_code` | `product_order_view` | 视图编码（唯一标识） |
| `view_name` | 产品订单视图 | 视图显示名称 |
| `view_desc` | 产品与订单关联视图，按产品汇总订单金额与数量 | 视图描述 |

**`object_codes`（视图包含的对象列表，扁平数组）：**

```json
["p_product_xxx", "p_order_xxx"]
```

> 注意：`object_codes` 是扁平列表，没有主/从对象之分。第一个对象被视作 anchor（主锚对象）。

**`object_relations`（对象间关联条件）：**

```json
[{
  "source_object_code": "p_product_xxx",
  "source_object_field_code": "product_code",
  "target_object_code": "p_order_xxx",
  "target_object_field_code": "product_code",
  "relation_type": "ONE_TO_MANY"
}]
```

> **重要约束**：`collect_view_info` 从 `object_relations` 自动推导视图字段，**但只会把 source/target 列名生成进去**——如果关联条件只用了一个 `product_code`，则视图中**只会有 `product_code` 这一个字段**，其他列（如 `product_name`、`quantity`）不会被自动拉入。
>
> 要包含更多字段，通过 `fields` 参数显式声明（见下方"视图字段"）。

**`fields`（视图字段，可选）：**

控制视图可查询的字段及其业务语义。不传则只包含关联键列。字段按 `property_code` 做 upsert 合并，可多轮调用补充。

```json
[{
  "property_code": "product_name",
  "property_name": "产品名称",
  "data_type": "STRING",
  "ext_property": {
    "property_role_rule": {
      "property_role": "DIMENSION",
      "rule_type": "name"
    }
  }
}, {
  "property_code": "quantity",
  "property_name": "数量",
  "data_type": "INTEGER",
  "ext_property": {
    "property_role_rule": {
      "property_role": "MEASURE",
      "rule_type": "raw_number"
    }
  }
}, {
  "property_code": "order_total",
  "property_name": "订单总金额",
  "data_type": "FLOAT",
  "ext_property": {
    "property_role_rule": {
      "property_role": "MEASURE",
      "rule_type": "derived_metric",
      "formula": "quantity * unit_price"
    }
  }
}]
```

**计算属性（带 `formula` 的字段）：**
- `rule_type` 设为 `derived_metric`、`formula_metric` 或 `virtual_tag` 时，需填 `formula`
- `formula` 是 SQL 表达式，查询时会被展开到 SELECT/WHERE/GROUP BY 中
- 表达式中的列名必须来自视图中已有的字段
- 若 `formula` 非空，OWL 中该字段的 `propertyGroup` 自动标为 `COMPUTED`

**关联条件：** `product.product_code = order.product_code`

### 1.4 Mock 数据

#### 产品数据

| product_code | product_name | category | status | unit_price |
|-------------|-------------|----------|--------|------------|
| `P001` | 数据工厂 | 数据平台 | 在售 | 150000.00 |
| `P002` | 智能分析平台 | 分析工具 | 在售 | 80000.00 |
| `P003` | 客户画像系统 | 数据应用 | 预研 | 120000.00 |

#### 订单数据

| order_code | order_name | product_code | customer_name | order_date | status | quantity | total_amount |
|-----------|-----------|-------------|---------------|------------|--------|----------|--------------|
| `O001` | 广州国投-数据工厂采购 | `P001` | 广州国投中债 | 2026-03-15 | 已完成 | 2 | 300000.00 |
| `O002` | 深圳创新-分析平台采购 | `P002` | 深圳创新科技 | 2026-04-20 | 待处理 | 1 | 80000.00 |

### 1.5 数据插入

对象创建完成后，先挂载再插入数据（`baiying_call` 必须挂载资源后才可用）。
流程遵循 [数据操作指南 §3.3](data-operations.md#33-执行录入) 的模式：

1. 执行 `mount_resource.py` 挂载目标对象到当前 Agent
2. 执行 `list_mounted_resources.py` 获取目标对象的数字 `resource_id`
3. 调用 `baiying_call`，`resource_type=OBJECT`，`resource_id` 为上一步获取的 ID
4. `query` 中用自然语言描述待插入的数据内容

**插入产品示例：**

```
baiying_call(
    resource_type=OBJECT,
    resource_id=<product 的 resourceId>,
    query="新增产品：产品编码P001，产品名称数据工厂，分类数据平台，状态在售，单价150000.00"
)
```

**插入订单示例：**

```
baiying_call(
    resource_type=OBJECT,
    resource_id=<order 的 resourceId>,
    query="新增订单：订单编码O001，订单名称广州国投-数据工厂采购，产品编码P001，客户名称广州国投中债，下单日期2026-03-15，状态已完成，数量2，订单金额300000.00"
)
```

> **注意**：产品数据必须先于订单数据插入，因为订单通过 `product_code` 关联产品。`resource_id` 是数字型 ID，通过 `list_mounted_resources.py` 运行时动态获取，不可硬编码。

### 1.6 脚本调用规范

所有结构化本体操作脚本位于 `scripts/ontology/structured/` 目录，以 skill 根目录为基准执行：

```bash
export BE_DOMAINNAME=${BE_DOMAINNAME:-ByaiService}
/usr/local/bin/python3 scripts/ontology/structured/<script>.py '<JSON>'
```

**可用脚本：**

| 脚本 | 用途 |
|------|------|
| `create_object.py` | 创建结构化对象（collect → submit 两阶段） |
| `create_view.py` | 创建本体视图 |
| `delete_object.py` | 删除结构化对象 |
| `delete_view.py` | 删除本体视图 |
| `list_mounted_resources.py` | 查询已有本体对象/视图列表 |
| `list_term_types.py` | 查询可绑定的术语类型 |
| `get_term_type_values.py` | 查询术语类型的值列表 |
| `mount_resource.py` | 挂载本体到当前数字员工 |

**创建对象示例（产品）：**

```bash
# 阶段一：收集信息
/usr/local/bin/python3 scripts/ontology/structured/create_object.py '{
  "action": "collect",
  "entity_code": "product",
  "entity_name": "产品",
  "entity_desc": "CRM 产品信息管理",
  "fields": [
    {
      "property_code": "product_code",
      "property_name": "产品编码",
      "data_type": "STRING",
      "ext_property": {
        "property_role_rule": {"property_role": "DIMENSION", "rule_type": "id"}
      }
    },
    {
      "property_code": "product_name",
      "property_name": "产品名称",
      "data_type": "STRING",
      "ext_property": {
        "property_role_rule": {"property_role": "DIMENSION", "rule_type": "name"}
      }
    },
    {
      "property_code": "category",
      "property_name": "产品分类",
      "data_type": "STRING",
      "ext_property": {
        "property_role_rule": {"property_role": "DIMENSION", "rule_type": "name"}
      }
    },
    {
      "property_code": "status",
      "property_name": "产品状态",
      "data_type": "STRING",
      "ext_property": {
        "property_role_rule": {"property_role": "DIMENSION", "rule_type": "name"}
      }
    },
    {
      "property_code": "unit_price",
      "property_name": "单价",
      "data_type": "FLOAT",
      "ext_property": {
        "property_role_rule": {"property_role": "MEASURE", "rule_type": "raw_number"}
      }
    }
  ]
}'

# 阶段二：确认提交
/usr/local/bin/python3 scripts/ontology/structured/create_object.py '{
  "action": "submit",
  "entity_code": "product"
}'
```

**创建视图示例（含计算属性）：**

```bash
# 阶段一：收集信息（object_codes 扁平列表 + object_relations + 含 formula 的 fields）
/usr/local/bin/python3 scripts/ontology/structured/create_view.py '{
  "action": "collect",
  "view_code": "product_order_view",
  "view_name": "产品订单视图",
  "view_desc": "产品与订单关联视图，按产品汇总订单金额与数量",
  "object_codes": ["p_product_xxx", "p_order_xxx"],
  "object_relations": [{
    "source_object_code": "p_product_xxx",
    "source_object_field_code": "product_code",
    "target_object_code": "p_order_xxx",
    "target_object_field_code": "product_code",
    "relation_type": "ONE_TO_MANY"
  }],
  "fields": [
    {"property_code": "product_name", "property_name": "产品名称", "data_type": "STRING",
     "ext_property": {"property_role_rule": {"property_role": "DIMENSION", "rule_type": "name"}}},
    {"property_code": "quantity", "property_name": "数量", "data_type": "INTEGER",
     "ext_property": {"property_role_rule": {"property_role": "MEASURE", "rule_type": "raw_number"}}},
    {"property_code": "order_total", "property_name": "订单总金额", "data_type": "FLOAT",
     "ext_property": {"property_role_rule": {"property_role": "MEASURE", "rule_type": "derived_metric", "formula": "quantity * unit_price"}}}
  ]
}'

# 阶段二：确认提交
/usr/local/bin/python3 scripts/ontology/structured/create_view.py '{
  "action": "submit",
  "view_code": "product_order_view"
}'
```

> **注意**：`object_codes` 是扁平列表，没有主/从对象之分。第一个对象（`p_product_xxx`）为 anchor 对象，运行时自动将其全部字段拉入视图；其他对象的字段必须通过 `fields` 显式声明才会暴露。`fields` 中的 `property_code` 须与关联键列名或 `object_codes` 中存在的列名匹配。

---

## 二、非结构化本体

### 2.1 会议纪要对象（meeting_note）

创建非结构化本体对象，绑定知识库目录中的会议纪要文档。会议纪要文档通过 `generate_meeting_minutes.py` 脚本的输出来获取。

**字段定义：**

| property_code | property_name | data_type | property_role | rule_type | 说明 |
|---------------|---------------|-----------|---------------|-----------|------|
| `meeting_theme` | 会议主题 | `STRING` | `DIMENSION` | `name` | 会议标题 |
| `meeting_date` | 会议日期 | `DATE` | `DIMENSION` | `date` | 开会日期 |
| `participants` | 参会人员 | `STRING` | `DIMENSION` | `name` | 逗号分隔的姓名列表 |
| `summary` | 会议摘要 | `STRING` | `DIMENSION` | `description` | 概要描述 |
| `todos` | 待办事项 | `STRING` | `DIMENSION` | `description` | 多行待办 |

**知识库绑定要求：**

| 必填字段 | 说明 | 获取方式 |
|---------|------|----------|
| `kb_id` | 知识库编码（resourceCode，非 resourceId） | `list_knowledge_bases.py` |
| `kb_directory` | 知识库内目录路径 | `list_kb_directories.py` |

### 2.2 会议纪要文档获取

三篇 DataCloud 项目会议纪要，通过 `scripts/meeting-minutes/generate_meeting_minutes.py` 获取：

```bash
/usr/local/bin/python3 scripts/meeting-minutes/generate_meeting_minutes.py --index 0 # 指定某一篇
```

**数据摘要：**

| 日期 | 主题 | 参会人员 | 关键内容 |
|------|------|---------|---------|
| 2026-05-25 | DataCloud平台需求确认会 | 黄药师、欧阳锋、韦小宝 | 四大核心模块需求优先级、MVP 计划（6/25 + 7/15） |
| 2026-05-26 | DataCloud研发技术方案评审会 | 欧阳锋、韦小宝、周伯通 | Iceberg + ClickHouse + PG + Redis 数据存储选型、Flink 流处理、Vue3 前端 |
| 2026-05-27 | DataCloud项目进度同步会 | 黄药师、欧阳锋、韦小宝、周伯通 | Sprint1 回顾（MySQL/PG 同步完成，API 部分完成）、Sprint2 计划、7/30 上线 |

### 2.3 数据插入

对象创建并挂载完成后，通过 `baiying_call` 将会议纪要文档全文写入。流程遵循 [数据操作指南 §3.3](data-operations.md#33-执行录入) 的模式：

1. 执行 `mount_resource.py` 挂载会议纪要对象到当前 Agent
2. 执行 `list_mounted_resources.py` 获取会议纪要对象的数字 `resource_id`
3. 调用 `baiying_call`，`resource_type=OBJECT`，`resource_id` 为上一步获取的 ID
4. `query` 中用自然语言描述插入意图，并附带完整的会议纪要文档正文

**插入示例：**

```
baiying_call(
    resource_type=OBJECT,
    resource_id=<会议纪要对象的 resourceId>,
    query="请将以下会议纪要内容录入到会议纪要对象中，需要包含完整的内容信息：[完整文档正文]"
)
```

> **说明：**
> - `[完整文档正文]` 来自 `generate_meeting_minutes.py` 的输出（默认 text 模式），是一篇完整的 Markdown 文档原文

### 2.4 脚本调用规范

所有非结构化本体操作脚本位于 `scripts/ontology/unstructured/` 目录，以 skill 根目录为基准执行：

```bash
export BE_DOMAINNAME=${BE_DOMAINNAME:-ByaiService}
/usr/local/bin/python3 scripts/ontology/unstructured/<script>.py '<JSON>'
```

**可用脚本：**

| 脚本 | 用途 |
|------|------|
| `create_object.py` | 创建非结构化对象（collect → submit 两阶段） |
| `delete_object.py` | 删除非结构化对象 |
| `list_mounted_resources.py` | 查询当前 Agent 已挂载的资源列表（含数字 resourceId） |
| `list_knowledge_bases.py` | 查询可用知识库列表（获取 kb_id） |
| `list_kb_directories.py` | 查询知识库目录（获取 kb_directory） |
| `list_term_types.py` | 查询可绑定的术语类型 |
| `get_term_type_values.py` | 查询术语类型的值列表 |
| `mount_resource.py` | 挂载本体到当前数字员工 |
---

## 三、字段角色速查

### 3.1 property_role（属性角色）

| 角色 | 说明 | 适用场景 |
|------|------|----------|
| `DIMENSION` | 维度属性 | 用于过滤、分组、排序的文本/日期类字段 |
| `MEASURE` | 度量属性 | 用于聚合计算（求和、平均、计数）的数值类字段 |

### 3.2 rule_type（规则类型）

| property_role | rule_type | 说明 | 典型字段示例 |
|---------------|-----------|------|-------------|
| `DIMENSION` | `id` | ID维度（外键/编码枚举） | `product_code`, `order_code` |
| `DIMENSION` | `name` | 名称维度（中文字符串枚举） | `product_name`, `customer_name` |
| `DIMENSION` | `description` | 描述维度 | `result`（拜访结果）、备注字段 |
| `DIMENSION` | `date` | 日期维度 | `order_date`, `visit_date` |
| `DIMENSION` | `datetime` | 时间戳维度 | 精确到时分秒的时间字段 |
| `DIMENSION` | `numeric` | 数值维度 | 可用作过滤条件的数值字段 |
| `MEASURE` | `raw_number` | 普通数值度量（支持SUM/AVG等） | `unit_price`, `total_amount`, `quantity` |
| `MEASURE` | `basic_metric` | 普通指标度量 | 预计算的聚合指标 |
| `MEASURE` | `derived_metric` | 派生度量（比率类，不可二次聚合） | `quantity * unit_price` |
| `MEASURE` | `formula_metric` | 指标公式度量（实时计算） | `revenue - cost` |
| `DIMENSION` | `virtual_tag` | 虚拟标签（SQL CASE WHEN） | `CASE WHEN amount > 100000 THEN '大额' END` |

> 带 `derived_metric` / `formula_metric` / `virtual_tag` 的字段**必须填 `formula`**（SQL 表达式），空字符串视为存储字段。查询时公式会被展开到 SELECT / WHERE / GROUP BY 中。

### 3.3 data_type（数据类型）

| 类型 | 说明 | 结构化映射 | 示例值 |
|------|------|-----------|--------|
| `STRING` | 字符串 | `TEXT` | `"数据工厂"` |
| `INTEGER` | 整数 | `INTEGER` | `2` |
| `FLOAT` | 浮点数 | `REAL` | `150000.00` |
| `BOOLEAN` | 布尔值 | `INTEGER` (0/1) | `true` |
| `DATE` | 日期 | `TEXT` (ISO 8601) | `"2026-03-15"` |

---

## 四、术语绑定

### 4.1 术语绑定字段

| 字段 | 必填 | 说明 |
|------|------|------|
| `term_type_code` | 否 | 绑定已有术语类型编码，来自 `list_term_types.py` |
| `rel_term_codeorname` | 否 | 绑定方式：`code`（按编码匹配，默认）或 `name`（按名称匹配） |
| `term_values` | 否 | 自定义枚举值列表，与 `term_type_code` 互斥，不能同时填写 |

### 4.2 常用术语类型

| term_type_code | 说明 | 绑定方式 |
|----------------|------|----------|
| `user_name` | 用户姓名（销售、负责人等） | `rel_term_codeorname: "name"` |
| `org_name` | 组织名称（部门、团队等） | `rel_term_codeorname: "code"` |
| `customer_name` | 客户名称 | `rel_term_codeorname: "code"` |
| `product_category` | 产品分类 | `rel_term_codeorname: "code"` |
| `order_status` | 订单状态 | `rel_term_codeorname: "code"` |

### 4.3 字段结构示例

```json
{
  "property_code": "sales_name",
  "property_name": "销售姓名",
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

### 4.4 注意事项

- `id` 字段由系统自动生成，**不需要在 fields 中传入**
- `property_code` 不能为 `id`
- `term_type_code` 和 `term_values` 互斥，同一字段只能选其一绑定
- 结构化对象 `entity_source` 为 `DYNAMIC_TABLE`，非结构化对象 `entity_source` 为 `KNOWLEDGE_BASE`
- 非结构化对象**不支持**视图，不需要 `create_view.py`
- 多轮对话流程：先 `collect`（收集信息），确认后 `submit`（提交）
