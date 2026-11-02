---
name: deepseek-web-search
description: 使用 DeepSeek Web Search 连接器检索最新互联网信息。用户要求联网搜索、查找最新资料、核实当前信息或需要网页来源时使用。优先使用用户个人授权，无可用个人授权时由后端使用平台全局配置。
metadata:
  openclaw:
    requires:
      bins: [node]
byclaw_managed: true
---

# DeepSeek 联网检索

不得使用 DSH 内置的 `web_search` 工具。ByClaw 会禁用该路径，所有联网检索必须通过本 Skill 和后端连接器策略执行。

通过后端连接器代理执行联网检索。后端优先使用当前用户在连接器页面独立授权并加密保存的 API Key；只有个人配置已开启且本次调用成功时才使用个人结果，其他情况均自动尝试平台全局配置。API Key 不会下发给 Skill 或沙箱。

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

- 连接器模板必须处于启用状态；后端按“有效个人配置 → 平台全局配置”的顺序选择凭据。
- `connector_availability` 中的 `deepseek-web-search` 已按“允许尝试后端全局兜底”归一化；应实际调用本脚本，不要仅根据个人授权状态提前判定连接器不可用。
- 个人配置不存在、关闭、过期、无权限或调用不可用时，Skill 不自行读取环境变量或配置文件，后端从统一的 `WEB_SEARCH_APIKEY` 提供方字典中解析并尝试全局兜底凭据。
- 收到 `DEEPSEEK_WEB_SEARCH_CONNECTOR_NOT_AUTHORIZED` 时，表示个人和全局配置都不可用，提示用户前往连接器页面配置或重新授权。
- 收到 `DEEPSEEK_WEB_SEARCH_CONNECTOR_DISABLED` 时，表示平台连接器模板已关闭，提示用户联系管理员启用连接器。

## 安全约束

- 只能调用本脚本，不自行拼接 `curl`，不直接访问 DeepSeek API。
- 不读取、记录或输出 API Key、登录 token、服务地址。
- 不把用户 ID、员工 ID 或 API Key 放入请求参数；身份只来自当前受信登录态。
