# 飞书任务

用于普通任务、待办、任务清单、子任务、负责人、关注人、提醒和附件。

## 路由边界

- 普通任务/项目任务/任务清单：本产品。
- 审批待办、同意/拒绝/转交：`approval`。
- 妙记里的 AI 待办：`minutes`，不要走 `task`。

## 常用命令

```bash
# 创建任务
lark-cli task +create --summary "跟进方案" --assignee <ou_open_id> --as user --format json

# 查看分配给我的任务
lark-cli task +get-my-tasks --as user --format json

# 搜索任务
lark-cli task +search --query "方案" --as user --format json

# 更新任务
lark-cli task +update --guid <task_guid> --summary "新标题" --as user --format json

# 完成任务
lark-cli task +complete --guid <task_guid> --as user --format json
```

## ID 规则

任务更新/完成/删除使用 `guid`，不是客户端展示编号。飞书任务链接中 `client/todo/task?guid=...` 的 query 参数就是 task guid。

## 注意事项

- 用户说"我负责/分配给我"时，默认先获取当前登录用户 open_id 或使用对应 shortcut。
- 查询结果里只有 open_id 时，必要时通过 `contact` 解析真实姓名。
- 设置重复规则或提醒通常需要先有截止时间。
- 删除任务、删除清单、批量改成员/状态前确认。
