# 考勤

用于飞书考勤打卡记录查询。

## 常用命令

考勤目前以原生 API 为主，调用前先查 schema：

```bash
lark-cli schema attendance.user_tasks.query --format json
lark-cli attendance user_tasks query \
  --params '{"employee_type":"employee_no"}' \
  --data '{"user_ids":[]}' \
  --as user --format json
```

## 参数规则

- `employee_type` 固定使用 `"employee_no"`，不要向用户询问。
- 查询个人记录时 `user_ids` 可按 CLI/平台要求传空数组或当前用户映射值；具体以 schema 为准。
- 需要查他人或团队考勤时先确认权限范围，权限不足不要绕过。

## 注意事项

- 考勤数据敏感，最终回复只展示用户请求需要的字段。
- 时间范围、时区不明确时先追问或按当前日期给出明确假设。
