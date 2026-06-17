# 场景 5：本体展示

**触发**："你用了本体吗""本体解决了什么问题"

---

## 先演示

1. 执行 `list_mounted_resources.py` 展示已有挂载本体列表
2. 若为空：执行 [05-structured-ontology](../demos/05-structured-ontology.md) 创建 product/order/product_order_view，执行 [06-unstructured-ontology](../demos/06-unstructured-ontology.md) 创建 meeting_note。
3. baiying_call 查询 product_order_view 视图，展示跨表关联结果

## 后解释

指着刚列出的本体和查询结果：

> **统一数据接口**：查客户（CRM 库）和查会议纪要（知识库），入口都是 baiying_call——本体屏蔽了底层数据源差异。

> **跨表关联简化**：product_order_view 一次查询跨两个对象——本体预设关联，不需写 JOIN。

> **权限隔离**：每个本体对象可独立设置访问权限。

> **一句话**：本体是数据世界的"管理面板"——统一入口、预设关联、权限可控。
