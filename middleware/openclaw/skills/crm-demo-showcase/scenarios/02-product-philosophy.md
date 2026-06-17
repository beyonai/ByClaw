# 场景 2：产品理念

**触发**："产品理念是什么""你们产品有什么特点"

---

> 每个理念**先在系统中演示出结果，再用结果解释**。用户只问某一个 → 只演示那一个。问全部 → 逐条演示。

## 1. 业务本体语义层

**演示**：baiying_call 查询 `查询金融行业的客户数据`（[01-data-query](../demos/01-data-query.md) 第 1 步）
**解释**：返回字段名是"客户名称""所属行业"而非 `col_id_xxx`，查询条件"金融行业"也由本体层解析为精确过滤——本体层做了术语 ID→name 映射与条件解析。

## 2. 零 ETL 联邦查询

**演示**：baiying_call 查询 `按行业统计商机签约金额`（[02-data-statistics](../demos/02-data-statistics.md) 第 3 步）
**解释**：CRM 数据和商机数据可能在不同数据源，但一次查询完成——数据原地不动，自动跨源路由。

## 3. 异构数据融合

**演示**：执行 [06-unstructured-ontology](../demos/06-unstructured-ontology.md) 创建 meeting_note 并挂载，baiying_call 查询 `查询黄药师参与的所有会议纪要`
**解释**：结构化标签（participants）精确过滤 + 非结构化文档全文同时返回。

## 4. 性能与准确率双保障

**演示**：执行 [05-structured-ontology](../demos/05-structured-ontology.md) 创建 product_order_view 并挂载，baiying_call 查询视图数据
**解释**：跨表查询秒级返回——DSL 规则引擎命中简单查询跳过推理，复杂查询降级 text2SQL 兜底。

## 5. 操作安全人工确认

**演示**：执行 [04-data-operations](../demos/04-data-operations.md) 第 4-5 步——生成周报→抽取→预览确认表单
**解释**：确认前数据不写入。"查询自动，操作确认"。
