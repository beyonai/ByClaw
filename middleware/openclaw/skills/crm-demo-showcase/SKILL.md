---
name: crm-demo-showcase
description: 演示已授权 CRM 对象和视图的数据查询、统计、歧义确认和数据操作。用户询问“给我演示一下”“查客户数据”“对象和视图怎么使用”时使用。
---

# CRM 对象与视图演示

按用户选择逐项演示，使用简体中文。执行前读取对应演示文档，依据真实接口结果回答，不编造数据。

## 可用演示

| 演示 | 内容 |
| --- | --- |
| [数据查询](demos/01-data-query.md) | 查询已授权视图 |
| [数据统计](demos/02-data-statistics.md) | 聚合统计 |
| [歧义处理](demos/03-ambiguity-handling.md) | 确认字段和查询条件 |
| [数据操作](demos/04-data-operations.md) | 周报信息提取和对象写入 |

## 准备与挂载

1. 使用 `bash scripts/setup.sh` 检查 Python 环境。
2. 从当前数字员工编码取得 resource_id，执行资源查询：

```bash
/usr/local/bin/python3 scripts/resources/list_mounted_resources.py '{"resource_id": <数字员工ID>}'
```

3. 仅使用已存在且有权限的 OBJECT/VIEW 资源。需要挂载时，先确认资源编码及类型，再调用：

```bash
/usr/local/bin/python3 scripts/resources/mount_resource.py '{"agent_id": <数字员工ID>, "resource_code": "<已确认的资源编码>", "resource_biz_type": "VIEW"}'
```

首次挂载后结束本轮，下一轮重新查询确认可用。缺少演示对象或视图时，请用户先在资源管理中创建或导入并授权，禁止自动建模、构造资源 ID 或使用其他用户资源。

## 工具调用

`baiying_call` 使用查询返回的数字 `resourceId`，`resource_type` 为 `VIEW` 或 `OBJECT`，`query` 为用户的具体请求。查询默认使用视图；对象写入需要用户明确授权。接口失败时展示返回错误，不声称操作成功。

## 辅助脚本

- `scripts/resources/list_mounted_resources.py`：查询已挂载对象和视图。
- `scripts/resources/mount_resource.py`：挂载已存在的对象或视图。
- `scripts/resources/unmount_resource.py`：卸载资源。
- `scripts/weekly-report/generate_weekly_report.py`：生成演示周报。

演示结束后总结实际结果，并引导选择其余可用演示。
