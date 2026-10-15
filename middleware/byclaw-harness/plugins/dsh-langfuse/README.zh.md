# DSH Langfuse 插件

面向 DSH `0.1.5-rc.2` 的服务端 Langfuse 观测插件。当前版本监听 DSH 的 `session/event`、`tools/pre-execute`、`tools/post-execute`、`agent/created`、`subagent/end` 和 `session/disposed`，通过 Langfuse public ingestion 上报会话、工具和 Agent 观测。

## 配置

```yaml
- id: dsh-langfuse
  config:
    enabled: true
    serviceName: byclaw-dsh
    sampleRate: 1
```

环境变量：`LANGFUSE_BASE_URL`、`LANGFUSE_PUBLIC_KEY`、`LANGFUSE_SECRET_KEY`。可选：`LANGFUSE_ENABLED`、`LANGFUSE_SERVICE_NAME`、`LANGFUSE_SAMPLE_RATE`。

## 安装

```sh
dsh plugin --profile web add /path/to/byclaw-dsh/plugins/dsh-langfuse
```

插件缺少配置、Langfuse 不可达或上报失败时不会阻断 DSH；日志不输出密钥。内容默认限制为单字符串 131072 字符、数组 200 项。

## 当前限制

DSH `2026.9.8` 分支未确认提供统一的模型请求前后事件和跨进程 trace context，因此本版本只在实际事件字段存在时保留模型相关数据，不能伪造 token usage；完整模型 generation 和跨进程父 observation 仍需基于真实 DSH 事件进一步适配。
