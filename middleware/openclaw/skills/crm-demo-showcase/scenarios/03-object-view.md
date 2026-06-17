# 场景 3：对象与视图

**触发**："什么是对象""什么是视图""对象和视图有什么区别"

---

## 先演示：创建并查询

按 [05-structured-ontology](../demos/05-structured-ontology.md) 执行全部 3 步：
1. create_object.py 创建 product 和 order 对象
2. create_view.py 创建 product_order_view 视图
3. mount → baiying_call 查询视图

## 后解释

指着刚创建的对象和查询结果：

> **对象**：product 和 order 就是对象——相当于数据库里的表，定义了字段结构，各自独立存储。

> **视图**：product_order_view 关联了产品和订单，按产品汇总金额——一次查询跨两个对象拿结果。

> **一句话**：对象存数据，视图查数据。对象是"仓库"，视图是"窗户"。
