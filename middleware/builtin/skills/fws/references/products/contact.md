# 通讯录

用于按姓名、邮箱、手机号解析用户，或根据 `open_id` 查询用户资料。

## 身份选择

- 按姓名/邮箱搜索同事：通常用 `--as user`。
- bot 已知 `open_id` 查用户：可用 bot，但受应用可见范围限制。
- 搜索不到手机号/姓名时，优先检查应用权限和可见范围，不要猜。

## 常用命令

```bash
# 按姓名/邮箱/手机号搜索用户
lark-cli contact +search-user --query "张三" --as user --format json

# 已知 open_id 获取用户资料
lark-cli contact +get-user --user-id <ou_open_id> --as user --format json

# 原生 API 前先看 schema
lark-cli schema contact.user_profiles.batch_query --format json
lark-cli contact user_profiles batch_query \
  --params '{"user_id_type":"open_id"}' \
  --data '{"user_ids":["ou_xxx"],"query_option":{"include_personal_status":true}}' \
  --as user --format json
```

## 工作流

### 人名 -> 发消息

1. `contact +search-user --query "<姓名>"`。
2. 如果多候选，展示候选姓名、部门、邮箱让用户选择。
3. 提取 `open_id` 后进入 `im`。

### 人名 -> 邀请会议

同样先解析 `open_id`，再进入 `calendar`。

## 注意事项

- 默认 ID 类型是 `open_id`。`union_id` / `user_id` 只在下游明确要求时再转换。
- 跨租户用户可能字段为空，这是平台可见性规则，不要强行补造。
- 用户搜索不出来时，不要自行改名匹配；报告可见范围或权限问题。
