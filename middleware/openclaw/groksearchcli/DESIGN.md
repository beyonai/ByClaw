# groksearchcli 设计：面向 Agent Skill 的 Grok 检索运行时

## 1. 目标与边界

Agent 根据业务需求开发 Skill，Skill 内的 Python 脚本通过 `groksearchcli` 使用官方 `xai_sdk`
Chat API 的 `web_search` 和 `x_search`。CLI 隔离凭据、SDK 协议、重试和响应结构，业务
Skill 只处理稳定 JSON。

第一版保证：

- `web search`、`x search` 和单请求联合检索 `research run`；
- 域名、X handle、日期和媒体理解参数在本地校验；
- API Key 不进入命令行、Skill 参数或结果；
- 业务命令的 stdout 始终为机器可读 JSON/JSONL，稳定返回 `ok`；`--help` 和 `--version` 遵循
  常规 CLI 文本行为；
- `describe` 在本地提供命令合同，不访问网络；
- xAI SDK Chat API 内部使用流式传输，进度事件写入 stderr，最终稳定 JSON 仍只写 stdout；
- 只读请求在明确可重试的网络、限流和服务端错误上有限重试。

第一版不保证：

- 返回传统搜索引擎的完整、稳定排序结果列表；
- 将实时 X 内容视为已验证事实；
- 定时任务、缓存、搜索历史或多供应商适配；
- Skill 绕过 CLI 直接调用 xAI。

## 2. 运行时架构

```text
用户业务请求
  └── Agent 开发的 Skill
       └── scripts/run.py（业务参数、业务输出和领域判断）
            └── groksearchcli（稳定命令和 JSON 合同）
                 ├── 参数校验与工具请求构造
                 ├── xAI 凭据和官方 xai_sdk
                 ├── 有限重试与错误归一化
                 └── 答案、引用、usage 和工具用量归一化
```

职责边界：

| 层 | 负责 | 不负责 |
|---|---|---|
| Skill | 业务参数、固定数据边界、调用 CLI、领域规则、业务结果 | API Key、HTTP、猜测 xAI 响应字段 |
| CLI | 参数合同、检索工具、凭据、HTTP、重试、稳定 JSON | 具体行业判断和业务写入 |
| xAI | Grok 推理、Web/X 服务端检索和引用 | Skill 的最终业务动作 |

流式传输是内部 transport，不改变公开结果合同。CLI 消费 SDK 的流式 response/chunk，每隔最多约 5 秒将
轻量 `groksearch.status` 业务状态写入 stderr，避免长时间静默连接被代理或任务运行器切断。
传入 `--verbose` 时，stderr 改为显示 `Thinking...`、服务端搜索工具及其参数等人类可读过程；只有
`response.completed` 中的完整 response 会进入最终 stdout。

## 3. 公开命令

```bash
groksearchcli web search --query "..."
groksearchcli x search --query "..."
groksearchcli research run --query "..."
groksearchcli describe web search
groksearchcli describe x search
groksearchcli describe research run
groksearchcli describe --all
```

`research run` 在一次 xAI SDK Chat 请求中同时注册两个工具。它不是分别调用 `web search` 和
`x search` 后拼接答案，Grok 可以根据上下文自主选择搜索顺序和次数。

## 4. 安全模型

平台在安装和运行 CLI 时注入 `XAI_API_KEY`。Skill 不接受、读取、输出或持久化该变量，也不允许
提供 `--api-key`。SDK 的服务地址和传输配置由平台环境控制，不属于业务 Skill 输入。

业务输入通过 `subprocess.run` 参数数组传入且固定 `shell=False`。域名只能是无端口、路径、认证和
查询参数的 hostname；X handle 在 CLI 内移除 `@` 后校验；日期必须为 ISO `YYYY-MM-DD`。

## 5. 输出合同

成功：

```json
{
  "ok": true,
  "operation": "groksearch.research.run",
  "data": {
    "answer": "...",
    "citations": [{"url": "https://...", "title": "...", "sourceType": "web"}],
    "images": []
  },
  "meta": {
    "model": "grok-4.6",
    "responseId": "resp_...",
    "toolUsage": {},
    "usage": {},
    "elapsedMs": 1000
  }
}
```

失败：

```json
{
  "ok": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "...",
    "retryable": true
  }
}
```

CLI 不承诺公开 xAI 原始响应。`data` 和 `meta` 是供 Skill 依赖的兼容层。

## 6. 错误和重试

CLI 直接使用官方 xAI SDK 的 Chat Streaming 调用，不在 CLI 内复制 HTTP 状态码重试逻辑。连接中断或
超时可能已触发服务端计费请求，Skill 不应在 CLI 外盲目自动重试，否则会把一次业务调用放大成多组
检索和费用。

退出码与同目录 CLI 保持一致：参数错误 `2`、策略错误 `11`、超时 `13`、运行时错误 `14`。

## 7. 测试策略

- CLI 合同测试验证参数到 xAI SDK 工具请求的映射；
- 本地校验测试保证错误发生在网络调用前；
- 客户端测试使用 Fake SDK Chat 验证官方 SDK 的工具、流式调用、引用和 usage 归一化；
- Agent 指南测试验证关键禁止项和示例入口；
- 真实集成测试应由显式环境开关启用，不在默认测试中消耗检索额度。
