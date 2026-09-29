---
name: crm-demo-showcase
description: 演示已授权 CRM 数据的查询、统计、歧义确认和数据操作。用户询问“给我演示一下”“查客户数据”时使用。
---

# CRM 数据演示

按用户选择逐项演示，使用简体中文。执行前读取对应演示文档，依据真实接口结果回答，不编造数据。

## 可用演示

| 演示 | 内容 |
| --- | --- |
| [数据查询](demos/01-data-query.md) | 查询已授权数据 |
| [数据统计](demos/02-data-statistics.md) | 聚合统计 |
| [歧义处理](demos/03-ambiguity-handling.md) | 确认字段和查询条件 |
| [数据操作](demos/04-data-operations.md) | 周报信息提取 |

## 准备与挂载

1. 使用 `bash scripts/setup.sh` 检查 Python 环境。
2. 从当前数字员工编码取得 resource_id，执行资源查询：

```bash
/usr/local/bin/python3 scripts/resources/list_mounted_resources.py '{"resource_id": <数字员工ID>}'
```

3. 对象（`OBJECT`）、视图（`VIEW`）、本体库（`ONTOLOGY_BASE`）、场景（`SCENE`）四类资源的
   能力已下线：本技能不再查询、不再挂载、不再调用它们，也不返回相关内容。请不要构造这四类
   资源 ID，也不要尝试通过 `baiying_call` 传入它们的 `resource_type`。
   需要演示数据时，请改用知识库（`KG_*`）或其它已上架资源。

> 完整的下线范围、响应行为与复验方式见 `docs/disabled-resource-capabilities.md`。

## 辅助脚本

- `scripts/resources/list_mounted_resources.py`：查询当前已挂载资源。
- `scripts/resources/mount_resource.py`：挂载已存在的资源。
- `scripts/resources/unmount_resource.py`：卸载资源。
- `scripts/weekly-report/generate_weekly_report.py`：生成演示周报。

演示结束后总结实际结果，并引导选择其余可用演示。
