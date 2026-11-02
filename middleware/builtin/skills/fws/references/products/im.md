# IM / 消息与群聊

用于飞书聊天消息、群聊、机器人消息、消息卡片、群成员、聊天记录和消息附件。

## 核心 ID

| 概念 | 常见格式 | 来源 |
|------|----------|------|
| 用户 open_id | `ou_xxx` | `contact +search-user` |
| 群 chat_id | `oc_xxx` | `im +chat-search` / `im +chat-list` |
| 消息 message_id | `om_xxx` | 发送或搜索消息返回 |
| 话题 thread_id | `om_xxx` / `omt_xxx` | 消息详情或 thread 列表 |

## 身份选择

- 机器人/应用身份发通知：优先 `--as bot`。
- 查询用户自己可见的消息、Feed、标记等：优先 `--as user`。
- bot 身份读取消息时若只显示 open_id 而没有姓名，通常是应用可见范围或通讯录权限不足。

发送消息前必须确认接收对象、消息内容和发送身份。用户已经在当前轮明确说出“给谁发什么”时可视为已确认；否则先把摘要给用户确认。

## 常用命令

```bash
# 搜索群
lark-cli im +chat-search --query "项目群" --as user --format json

# 机器人发群消息
lark-cli im +messages-send --chat-id <oc_chat_id> --text "通知内容" --as bot --format json

# 给用户发单聊消息；open_id 先从 contact 获取
lark-cli im +messages-send --user-id <ou_open_id> --text "请查收" --as bot --format json

# 回复某条消息
lark-cli im +messages-reply --message-id <om_message_id> --text "收到" --as bot --format json

# 拉取群消息
lark-cli im +chat-messages-list --chat-id <oc_chat_id> --as user --format json
```

## 群管理

| 目标 | 命令入口 |
|------|----------|
| 建群 | `im +chat-create` |
| 查群列表 | `im +chat-list` |
| 搜索群 | `im +chat-search` |
| 查看群成员 | `im +chat-members-list` |
| 修改群名称/描述 | `im +chat-update` |

移除成员、修改群管理权限、撤回/删除消息属于高风险操作，执行前确认。

## 卡片消息

发送交互卡片时：
- 使用 `im +messages-send`，`--msg-type interactive`，`--content` 传合法卡片 JSON。
- 先用 `--dry-run` 检查请求。
- 卡片 JSON 不确定时，查看 `lark-cli im +messages-send --help` 和官方卡片 schema，不要手写猜字段。
- 卡片按钮回调属于事件/回调能力，不是普通拉消息；用 `event`/后端回调处理。

## 注意事项

- 群名、人名搜索可能多候选；有副作用前必须让用户确认目标。
- 机器人发消息失败时，优先检查 bot 是否在群、应用可见范围、IM scope。
- 下载消息资源时明确输出目录，避免落到项目根目录。
