---
name: deepseek-web-search
description: 使用用户独立授权的 DeepSeek Web Search 连接器检索最新互联网信息。用户要求联网搜索、查找最新资料、核实当前信息或需要网页来源时使用。连接器未授权或已禁用时不可使用。
metadata:
  openclaw:
    requires:
      bins: [node]
byclaw_managed: true
---

# DeepSeek 联网检索

通过后端连接器代理执行联网检索。API Key 由当前用户在连接器页面独立授权并加密保存，不会下发给 Skill 或沙箱。

脚本复用平台服务发现注入的 `BYAI_SERVICE_BASE_URL`（兼容 `KN_MANAGER_URL` 和本地 BE 地址变量）定位 ByClaw 后端，并复用当前运行环境的 Beyond-Token；没有 Token 时兼容平台 Session 与签名认证。不得由模型传入服务地址、用户身份或认证信息。

## 命令

```bash
node scripts/deepseek-web-search.mjs \
  --query "需要检索的问题一" \
  --query "需要检索的问题二" \
  --max-results 10
```

- `query` 必填，可重复 1–4 次；重复问题会按首次出现顺序去重，每个问题最长 2000 字符。
- `max-results` 可选，范围 1–20，默认 10。
- 多个问题由后端并发检索，并按问题轮询合并、按 URL 去重；`max-results` 是合并结果总上限。
- 输出为 JSON，`sources` 中包含 `url`、可选的 `title`、`snippet`、`publishedAt`。

应依据来源回答，并保留可点击的来源链接。不要声称已访问未出现在结果中的网页。

## 启用与禁用

- 只有当前用户已完成 DeepSeek Web Search 连接器授权且连接器处于启用状态时，后端才执行请求。
- 用户禁用或解除授权后，后端拒绝请求；不得改用环境变量、直接请求 DeepSeek、读取配置文件等方式绕过。
- 收到 `DEEPSEEK_WEB_SEARCH_CONNECTOR_NOT_AUTHORIZED` 时，提示用户先在连接器页面完成独立授权。
- 收到 `DEEPSEEK_WEB_SEARCH_CONNECTOR_DISABLED` 时，提示用户到连接器页面重新开启连接器。

## 安全约束

- 只能调用本脚本，不自行拼接 `curl`，不直接访问 DeepSeek API。
- 不读取、记录或输出 API Key、登录 token、服务地址。
- 不把用户 ID、员工 ID 或 API Key 放入请求参数；身份只来自当前受信登录态。
