# Base / 多维表格

用于飞书多维表格（Base/bitable）的表、字段、记录、视图、表单、仪表盘、workflow 和权限角色管理。

## 先定位 Base

任何操作前先拿真实 `base_token`，不要把完整 URL、wiki token 或 workspace token 直接当 `base_token`。

```bash
# 从 URL 解析
lark-cli base +url-resolve --url "<base_url>" --as user --format json

# 从标题关键词解析；多候选让用户选择
lark-cli base +title-resolve --title "项目" --as user --format json

# 查看 Base 信息
lark-cli base +base-get --base-token <base_token> --as user --format json
```

## 常用入口

| 目标 | 命令入口 |
|------|----------|
| 创建 Base | `base +base-create` |
| 查看资源目录 | `base +base-block-list` |
| 表管理 | `base +table-list/get/create/update/delete` |
| 字段管理 | `base +field-list/get/create/update/delete` |
| 记录读写 | `base +record-list/search/get/upsert/batch-create/batch-update/delete` |
| 附件字段 | `base +record-upload-attachment` / `+record-download-attachment` |
| 视图 | `base +view-*` |
| 聚合查询 | `base +data-query` |
| 表单 | `base +form-*` |
| 仪表盘 | `base +dashboard-*` |
| workflow | `base +workflow-*` |

## 写入规则

- 写记录前先读取表结构和字段配置，只写存储字段。
- 系统字段、公式字段、lookup 字段通常只读，不当普通单元格写。
- 人员、日期、附件、单选/多选、关联字段要按 field schema 构造，不要用展示值猜。
- 删除字段/表/记录/Base 前必须确认。
- 批量写同一表时串行执行，避免并发冲突。

## 查询规则

- `has_more=true` 时不能基于当前页回答全局结论。
- 全局统计、TopN、分组聚合优先使用 Base 云端查询能力，不要只拉一页到本地算。
- 多表关联要读取关联字段和目标表结构；link cell 里的 `record_id` 只是连接键。

## 文件导入

本地 Excel/CSV/`.base` 导入成 Base 时先走 `drive +import --type bitable`，导入完成后再回到 `base` 做表内操作。
