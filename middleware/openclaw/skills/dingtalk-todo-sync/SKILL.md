---
name: dingtalk-todo-sync
description: >
  扫描 GitHub Issues 并同步为钉钉待办消息。通过钉钉 Webhook 机器人推送
  结构化的待办列表到钉钉群。触发词：同步待办、推送到钉钉、钉钉通知、待办同步。
metadata:
  openclaw:
    requires:
      bins: [node]
---

# 钉钉待办同步

扫描 GitHub Issues，生成结构化待办列表，通过钉钉 Webhook 机器人推送到钉钉群。

## Default Configuration

- **Default repository**: `beyonai/ByClaw`
- **GitHub 授权**: 平台 GitHub 连接器统一授权
- **钉钉**: 需要 `DINGTALK_WEBHOOK_URL` 环境变量（Webhook 机器人地址）
- **可选**: `DINGTALK_WEBHOOK_SECRET`（加签密钥）

## Workflow

**IMPORTANT**: Always start by executing Step 0. Do NOT mention GITHUB_TOKEN or PAT.

### Step 0: Check Configuration (MANDATORY FIRST STEP)

先检查 GitHub 授权：
```bash
node skills/github-issues-mgmt/scripts/gh-issues-list.mjs --limit 1
```

If `"auth_required": true` → 展示 output 的 `message`，提示用户先在平台连接器中授权 GitHub，然后停止本次同步。授权成功后凭据会通过用户私有工作区自动同步到当前沙箱，无需重启。

---

再检查钉钉 Webhook：
```bash
echo '{"title":"test","items":[]}' | node skills/dingtalk-todo-sync/scripts/dingtalk-notify.mjs
```

If `"auth_required": true` (DINGTALK_WEBHOOK_URL missing):

---

钉钉 Webhook 未配置。请按以下步骤操作：

1. 打开钉钉群 → 群设置 → 智能群助手 → 添加机器人 → 自定义
2. 安全设置选择"加签"（推荐）或"自定义关键词"
3. 复制 Webhook URL，设置环境变量：

```
export DINGTALK_WEBHOOK_URL=https://oapi.dingtalk.com/robot/send?access_token=xxx
export DINGTALK_WEBHOOK_SECRET=SECxxx  # 如果选了加签
```

---

Then STOP.

---

## Mode 1: 扫描 Issues → 推送钉钉待办

### When to Use

用户说"同步待办到钉钉"、"推送 issues 到钉钉"、"钉钉待办同步"等。

### Steps

1. 获取 open issues：

```bash
node skills/github-issues-mgmt/scripts/gh-issues-list.mjs --state open --limit 30
```

2. 整理为待办列表，按优先级/标签分组

3. 推送到钉钉：

```bash
echo '{
  "title": "📋 ByClaw 待办同步",
  "items": [
    {"number": 1, "title": "修复登录bug", "assignee": "user1", "url": "https://github.com/beyonai/ByClaw/issues/1"},
    {"number": 2, "title": "新增功能", "assignee": "user2", "url": "https://github.com/beyonai/ByClaw/issues/2"}
  ]
}' | node skills/dingtalk-todo-sync/scripts/dingtalk-notify.mjs
```

4. 报告推送结果

### 推送格式

钉钉消息格式为 Markdown，效果如下：

```
## 📋 ByClaw 待办同步

- [ ] [#1](url) 修复登录bug @user1
- [ ] [#2](url) 新增功能 @user2
- [ ] [#3](url) 优化性能

> 共 3 条待办 | 2026/5/29 10:00:00
```

---

## Mode 2: 自定义消息推送

### When to Use

用户说"发消息到钉钉"、"通知钉钉群"等。

### Steps

用户提供消息内容，构造 payload 推送：

```bash
echo '{
  "msgtype": "markdown",
  "markdown": {
    "title": "通知标题",
    "text": "## 通知内容\n\n详细信息..."
  }
}' | node skills/dingtalk-todo-sync/scripts/dingtalk-notify.mjs
```

也支持纯文本：

```bash
echo '{
  "msgtype": "text",
  "text": { "content": "这是一条通知消息" }
}' | node skills/dingtalk-todo-sync/scripts/dingtalk-notify.mjs
```

---

## Scripts Reference

| 脚本 | 用途 |
|------|------|
| `dingtalk-notify.mjs` | 发送消息到钉钉 Webhook |

依赖 `github-issues-mgmt` skill 的 `gh-issues-list.mjs` 来获取 issues 数据。

## Important Notes

- 钉钉 Webhook 有频率限制：每分钟最多 20 条消息
- 如果 issues 很多，分批推送或只推送高优先级的
- 默认仓库 `beyonai/ByClaw`，不需要问用户
- 中文回复
