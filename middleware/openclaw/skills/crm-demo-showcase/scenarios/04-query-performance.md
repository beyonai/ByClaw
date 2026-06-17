# 场景 4：查询性能

**触发**："查询又快又准""数据查询怎么这么快"

---

## 先演示

1. baiying_call 查询 `查询金融行业的客户数据`（[01-data-query](../demos/01-data-query.md) 第 1 步）——秒级返回
2. 执行 [05-structured-ontology](../demos/05-structured-ontology.md) 创建 product_order_view 并挂载，baiying_call 查询视图——跨表秒级返回

## 后解释

> 为什么快？DSL 规则引擎优先命中简单查询 → 生成优化执行计划 → 单次返回，跳过大模型推理耗时。

> 跨表为什么也快？传统方式：先查产品表→逐条查订单表→手动汇总，多次往返。视图预设关联，一次走完。

> 复杂查询呢？命中不了规则时降级 text2SQL，由大模型生成 SQL 执行，保证准确。

> **规则路径保速度，SQL 路径保兜底**。
