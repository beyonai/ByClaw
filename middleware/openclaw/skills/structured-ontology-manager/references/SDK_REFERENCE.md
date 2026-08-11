# Action 脚本 SDK 参考手册

Action 脚本由 `ScriptExecutor` 以 `execute(params: dict) -> dict` 形式执行。
所有 mapper 实例、实体类和公共工具在执行前自动注入到脚本命名空间，**无需 import**。

## 注入的变量

| 变量名 | 类型 | 说明 |
|--------|------|------|
| `Q` | `QueryWrapper` 工厂 | 链式条件构造器，每次链式调用返回新实例（不可变） |
| `A` | `AggWrapper` 工厂 | 链式聚合构造器，每次链式调用返回新实例（不可变） |
| `context` | `RequestContext \| None` | 当前请求上下文，含用户信息、认证令牌等（见下节） |
| `<entity_code>_mapper` | `<EntityClass>Mapper` | 每个工作区对象各注入一个 mapper 实例 |
| `<EntityClass>` | dataclass 类 | 实体类，含 `F` 内部类（字段名常量），用于构造新记录 |
| `params` | `dict` | Action 调用时的入参 |

## ⚠️ 对象编码、Mapper 和实体类命名（必须使用完整编码）

对象编码来自工作区状态。新工作区使用后台生成的 `workspace_code` 前缀，历史工作区继续使用用户编码后缀，例如：

```text
新工作区：w7k3m9p2x_employee、w7k3m9p2x_leave_record
历史工作区：employee_0027029322、leave_record_0027029322
```

`ScriptExecutor` 使用**完整的 `entity_code`**生成注入变量。v2 的工作区前缀和历史工作区的用户编码后缀都是对象编码的一部分，生成 Action 脚本时不得删除、缩写、替换或只保留业务编码。

### 固定转换规则

给定完整对象编码：

```text
entity_code = w7k3m9p2x_leave_record
```

注入名称为：

```text
Mapper 变量：w7k3m9p2x_leave_record_mapper
实体类：     W7k3m9p2xLeaveRecord
字段常量：   W7k3m9p2xLeaveRecord.F.<property_code>
SDK 文件：   w7k3m9p2x_leave_record_sdk.py
```

转换算法：

1. **Mapper**：完整 `entity_code` 原样保留，再拼接 `_mapper`
2. **实体类**：按 `_` 拆分完整 `entity_code`，每段首字母大写后直接连接；纯数字段原样保留
3. **不得去掉编码组成部分**：`workspace_code` 前缀或历史用户编码后缀必须同时出现在 mapper 变量和实体类中

| 完整 entity_code | 正确 Mapper | 正确实体类 |
|------------------|-------------|------------|
| `w7k3m9p2x_employee` | `w7k3m9p2x_employee_mapper` | `W7k3m9p2xEmployee` |
| `w7k3m9p2x_leave_record` | `w7k3m9p2x_leave_record_mapper` | `W7k3m9p2xLeaveRecord` |
| `employee_0027029322` | `employee_0027029322_mapper` | `Employee0027029322` |
| `leave_record_0027029322` | `leave_record_0027029322_mapper` | `LeaveRecord0027029322` |

### 正确与错误示例

```python
# ✅ 正确：完整对象编码为 w7k3m9p2x_leave_record
record = await w7k3m9p2x_leave_record_mapper.select_by_id(record_id)
await w7k3m9p2x_leave_record_mapper.update_by_id(
    W7k3m9p2xLeaveRecord(id=record_id, status="已通过")
)
status_field = W7k3m9p2xLeaveRecord.F.status

# ❌ 错误：擅自删除工作区前缀，运行时会 NameError
record = await leave_record_mapper.select_by_id(record_id)
await leave_record_mapper.update_by_id(
    LeaveRecord(id=record_id, status="已通过")
)
```

### 生成脚本前的强制核对

生成或修改 Action 脚本前，必须：

1. 从当前工作区对象定义或 `get_workspace.py` / `get_object.py` 的结果读取完整 `entity_code`
2. 若工作区已有 SDK，优先读取 `sdk/<entity_code>_sdk.py`，以其中实际类名为最终依据
3. 列出脚本访问的所有对象及其“完整编码 → mapper → 实体类”映射
4. 检查脚本中每个 `*_mapper` 和实体类是否都保留当前工作区版本要求的完整编码
5. `collect_action.py` 的 `object_references` 也必须填写其他对象的完整 `entity_code`

禁止根据中文对象名、业务简称或记忆猜测注入名称。如果没有取得完整 `entity_code`，不得开始编写脚本。

例：工作区含 `w7k3m9p2x_travel_application` 和 `w7k3m9p2x_travel_expense` 时，注入：
`Q`、`A`、`context`、`w7k3m9p2x_travel_application_mapper`、`W7k3m9p2xTravelApplication`、
`w7k3m9p2x_travel_expense_mapper`、`W7k3m9p2xTravelExpense`。

### context（当前用户信息）

`context` 是 `RequestContext` 对象，在脚本命名空间中直接可用（无需 import）。
**注意**：测试环境或未设置上下文时 `context` 可能为 `None`，建议加保护。

| 属性 | 说明 | 示例值 |
|------|------|--------|
| `context.user_id` | 当前用户 code（登录名/工号） | `"zhangsan"` |
| `context.extras["user_name"]` | 用户显示名称 | `"张三"` |
| `context.session_id` | 当前会话 ID | `"sess_abc123"` |
| `context.token` | 认证令牌 | `"Bearer ..."` |

**用法示例：**

```python
async def execute(params: dict) -> dict:
    # 获取当前用户 code
    user_code = context.user_id if context else ""

    # 获取用户显示名称（从 extras，可能为空）
    user_name = ((context.extras or {}).get("user_name", "")) if context else ""

    # 将当前用户作为申请人写入记录
    record = TravelApplication0027029322(
        applicant=user_code,
        ...
    )
```

---

### F 内部类（字段名常量）

每个实体类都有 `F` 内部类，字段名字符串常量，避免拼写错误：

```python
TravelApplication0027029322.F.status        # → "status"
TravelApplication0027029322.F.total_amount  # → "total_amount"
TravelExpense0027029322.F.expense_type      # → "expense_type"
```

---

## 返回值格式（必须严格遵守）

```python
return {
    "records": [...],          # 结果列表，每项为 dict
    "total": N,                # 本次返回条数
    "meta": {
        "columns": [{"name": "field1"}, {"name": "field2"}, ...],
        "total": N,
    },
}
```

错误时返回（不抛异常）：

```python
return {
    "records": [{"success": False, "error": "错误描述"}],
    "total": 1,
    "meta": {"columns": [{"name": "success"}, {"name": "error"}], "total": 1},
}
```

---

## Mapper 核心方法

### 返回值结构速查

| 方法 | 返回类型 |
|------|----------|
| `select_by_id(id)` | `Entity \| None` |
| `insert(entity)` | `Entity`（id 已更新） |
| `update_by_id(entity)` | `bool` |
| `delete_by_id(id)` | `bool` |
| `select(q)` | `dict[str, Any]`（含 records / total / meta） |
| `select_one(q)` | `Entity \| None` |
| `count(q)` | `int` |
| `agg(a)` | `dict[str, Any]`（含 records / total / meta） |

---

### 基础 CRUD

#### 对象型 LIST_TERM 参数

父对象实际生效的 `term_sync.term_code_field` 决定下拉 code 的含义；Action 查询字段必须等于 `term_code_field`，子表关联字段也必须保存同一个值。

当 `term_code_field=id`（含缺失/空值的默认情况）时，参数声明为 integer，并使用主键方法：

```python
parent_id = int(params["parent_id"])
parent = await parent_mapper.select_by_id(parent_id)
if parent is None:
    return {"records": [{"success": False, "error": "关联对象不存在"}], "total": 1,
            "meta": {"columns": [{"name": "success"}, {"name": "error"}], "total": 1}}

child = await child_mapper.insert(ChildEntity(parent_id=parent_id))
```

当 `term_code_field=parent_code` 时，参数类型与该字段一致，并查询同一字段：

```python
parent_code = params["parent_code"]
rows = await parent_mapper.select(Q.eq(Parent.F.parent_code, parent_code).limit(1))
child = await child_mapper.insert(ChildEntity(parent_code=parent_code))
```

禁止 `term_code_field=id` 却按业务编码字段查询，也禁止 `term_code_field=parent_code` 却调用 `select_by_id`。

```python
# 按主键查询，不存在返回 None
record = await mapper.select_by_id(id: int) -> Entity | None
```

返回值：单个实体对象（dataclass 实例）；记录不存在时返回 `None`。

---

```python
# 插入记录，返回注入了自增 id 的实体对象
entity = await mapper.insert(entity: Entity) -> Entity
```

返回值：传入的同一个实体对象，`entity.id` 已被更新为数据库生成的自增主键。

```python
new_app = TravelApplication0027029322(applicant="zhangsan", status="草稿")
new_app = await travel_application_0027029322_mapper.insert(new_app)
print(new_app.id)  # → 42（数据库自增值）
```

---

```python
# 按主键更新（只更新实体中非 None 的字段，entity.id 必须有值）
ok = await mapper.update_by_id(entity: Entity) -> bool
```

返回值：`bool`。`True` 表示有行被更新（`affected > 0` 或后端返回了 records）；`False` 表示 `entity.id` 为空、或无匹配记录。

---

```python
# 按主键删除
ok = await mapper.delete_by_id(id: int) -> bool
```

返回值：`bool`。`True` 表示删除成功（`affected > 0`）；`False` 表示记录不存在。

---

### 条件查询（QueryWrapper）

```python
rows = await mapper.select(wrapper: QueryWrapper) -> dict[str, Any]
```

返回值：`dict[str, Any]`，结构如下：

```python
{
    "records": [                    # 查询结果行列表，每行为 dict
        {"id": 1, "status": "已提交", "total_amount": 3200.0, ...},
        ...
    ],
    "total": 20,                    # 本页实际返回条数
    "meta": {
        "viewId": "auto_view",
        "columns": [                # 列元数据
            {"name": "id",     "label": "id",     "type": "integer"},
            {"name": "status", "label": "status", "type": "string"},
            ...
        ],
        "total": 20,                # 同 total
    },
}
```

> **注意**：`records` 中每个元素是 `dict`，不是实体对象。需要实体对象时用 `select_one()`。

---

```python
# 查第一条，不存在返回 None
record = await mapper.select_one(wrapper: QueryWrapper) -> Entity | None
```

返回值：单个实体对象（dataclass 实例）；无匹配记录时返回 `None`。

---

```python
# 计数
n = await mapper.count(wrapper: QueryWrapper) -> int
```

返回值：`int`，满足条件的记录总数；无匹配时返回 `0`。

---

### 聚合统计（AggWrapper）

```python
result = await mapper.agg(wrapper: AggWrapper) -> dict[str, Any]
```

返回值：`dict[str, Any]`，结构与 `select()` 相同，但 `records` 中每行是聚合结果：

```python
{
    "records": [
        {"expense_type": "交通", "amount": 3200.0, "id": 5},
        ...
    ],
    "total": 3,
    "meta": {...},
}
```

- **无 `group_by`（全表聚合）**：`records` 长度恒为 `1`，键名为聚合函数对应的字段名（或 `as_` 别名）。
- **有 `group_by`（分组聚合）**：每组对应 `records` 中一个元素，包含分组字段和所有聚合字段。
- 无结果时 `records` 为 `[]`。

取聚合值的惯用写法：

```python
rows = (await travel_application_0027029322_mapper.agg(
    A.sum(TravelApplication0027029322.F.total_amount)
     .count()
     .where(Q.eq(TravelApplication0027029322.F.status, "已批准"))
))["records"]
result = rows[0] if rows else {}
total = result.get("total_amount", 0)  # → 58600.0
count = result.get("id", 0)            # → 12
```

---

> **说明**：`select_by_<field>`、`sum_<field>`、`avg_<field>` 等快捷方法**不存在**，
> 请直接用 `select(Q.eq(...))` 和 `agg(A.sum(...))` 替代。

---

## QueryWrapper（Q）方法表

所有方法返回新的 `QueryWrapper` 实例，支持链式调用。

| 方法 | 说明 | 示例 |
|------|------|------|
| `.eq(field, value)` | 等于 | `Q.eq(F.status, "已提交")` |
| `.ne(field, value)` | 不等于 | `Q.ne(F.status, "草稿")` |
| `.gt(field, value)` | 大于 | `Q.gt(F.total_amount, 0)` |
| `.gte(field, value)` | 大于等于 | `Q.gte(F.total_amount, 1000)` |
| `.lt(field, value)` | 小于 | `Q.lt(F.total_amount, 5000)` |
| `.lte(field, value)` | 小于等于 | `Q.lte(F.total_amount, 5000)` |
| `.like(field, pattern)` | 模糊匹配 | `Q.like(F.reason, "%北京%")` |
| `.in_(field, values)` | IN 列表 | `Q.in_(F.status, ["已批准", "审批中"])` |
| `.is_null(field)` | 为空 | `Q.is_null(F.approver_l2)` |
| `.is_not_null(field)` | 不为空 | `Q.is_not_null(F.submit_time)` |
| `.order_by(field, desc=False)` | 排序 | `.order_by(F.submit_time, desc=True)` |
| `.page(page, page_size=20)` | 分页 | `.page(1, 20)` |
| `.limit(n)` | 限制条数 | `.limit(100)` |

多条件链式示例：

```python
result = await travel_application_0027029322_mapper.select(
    Q.eq(TravelApplication0027029322.F.status, "审批中")
     .gte(TravelApplication0027029322.F.total_amount, 1000)
     .is_not_null(TravelApplication0027029322.F.approver_l1)
     .order_by(TravelApplication0027029322.F.submit_time, desc=True)
     .page(1, 20)
)
rows = result["records"]  # list[dict]
```

---

## AggWrapper（A）方法表

所有方法返回新的 `AggWrapper` 实例，支持链式调用。

| 方法 | 说明 | 示例 |
|------|------|------|
| `.count(field="id", as_=None)` | 计数 | `A.count()` |
| `.sum(field, as_=None)` | 求和 | `A.sum(F.amount)` |
| `.avg(field, as_=None)` | 平均值 | `A.avg(F.total_amount)` |
| `.max(field, as_=None)` | 最大值 | `A.max(F.submit_time)` |
| `.min(field, as_=None)` | 最小值 | `A.min(F.total_amount)` |
| `.group_by(*fields)` | 分组字段 | `.group_by(F.expense_type)` |
| `.where(wrapper)` | 过滤条件 | `.where(Q.eq(F.app_id, app_id))` |
| `.order_by(field, desc=False)` | 排序 | `.order_by(F.amount, desc=True)` |
| `.limit(n)` | 限制返回组数 | `.limit(10)` |

全表聚合示例（`records` 长度为 1）：

```python
agg_result = await travel_application_0027029322_mapper.agg(
    A.sum(TravelApplication0027029322.F.total_amount)
     .count()
     .avg(TravelApplication0027029322.F.total_amount)
     .where(Q.eq(TravelApplication0027029322.F.status, "已批准"))
)
result = agg_result["records"][0] if agg_result["records"] else {}
# result → {"total_amount": 58600.0, "id": 12, "total_amount_avg": 4883.33}
```

分组聚合示例：

```python
agg_result = await travel_expense_0027029322_mapper.agg(
    A.sum(TravelExpense0027029322.F.amount)
     .count(TravelExpense0027029322.F.id)
     .group_by(TravelExpense0027029322.F.expense_type)
     .where(Q.eq(TravelExpense0027029322.F.app_id, app_id))
     .order_by(TravelExpense0027029322.F.amount, desc=True)
)
rows = agg_result["records"]
# rows → [{"expense_type": "交通", "amount": 3200.0, "id": 5}, ...]
```

---

## 完整脚本示例

```python
async def execute(params: dict) -> dict:
    app_id = int(params.get("app_id", 0))
    F_app = TravelApplication0027029322.F
    F_exp = TravelExpense0027029322.F

    # 1. 查主记录（返回实体对象或 None）
    app = await travel_application_0027029322_mapper.select_by_id(app_id)
    if app is None:
        return {"records": [{"success": False, "error": "申请不存在"}],
                "total": 1, "meta": {"columns": [{"name": "success"}, {"name": "error"}], "total": 1}}

    # 2. 查关联费用（select 返回 dict，取 records 字段得到行列表）
    expense_result = await travel_expense_0027029322_mapper.select(
        Q.eq(F_exp.app_id, app_id).limit(500)
    )
    expenses = expense_result["records"]  # list[dict]

    # 3. 统计费用总额（agg 返回 dict，从 records[0] 取聚合值）
    agg_total = await travel_expense_0027029322_mapper.agg(
        A.sum(F_exp.amount).where(Q.eq(F_exp.app_id, app_id))
    )
    total = (agg_total["records"][0].get("amount", 0)) if agg_total["records"] else 0

    # 4. 按费用类型分组统计
    agg_by_type = await travel_expense_0027029322_mapper.agg(
        A.sum(F_exp.amount).count(F_exp.id)
         .group_by(F_exp.expense_type)
         .where(Q.eq(F_exp.app_id, app_id))
         .order_by(F_exp.amount, desc=True)
    )
    by_type = agg_by_type["records"]  # [{"expense_type": "交通", "amount": 3200.0, "id": 5}, ...]

    # 5. 更新主记录（update_by_id 返回 bool）
    await travel_application_0027029322_mapper.update_by_id(
        TravelApplication0027029322(id=app_id, status="已提交", total_amount=total)
    )

    # 6. 返回结果
    return {
        "records": [{"success": True, "app_id": app_id,
                     "total_amount": total, "by_type": by_type}],
        "total": 1,
        "meta": {
            "columns": [{"name": "success"}, {"name": "app_id"},
                        {"name": "total_amount"}, {"name": "by_type"}],
            "total": 1,
        },
    }
```
