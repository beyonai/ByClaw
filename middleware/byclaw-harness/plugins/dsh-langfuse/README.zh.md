# DSH Langfuse 插件

面向 `beyonai/byclaw-harness` 的 `2026.9.8` 分支及 DSH `0.2.0-rc.2`。插件使用 DSH Host 生命周期，以 OpenTelemetry OTLP HTTP/protobuf 上报请求、模型、工具和子代理 observation；仅使用 Langfuse public ingestion 补写根 trace 的最终 input/output、sessionId 和 userId。

## 配置

```yaml
- id: dsh-langfuse
  config:
    enabled: true
    serviceName: byclaw-dsh
    sampleRate: 1
    flushIntervalMs: 1000
    maxText: 131072
    maxArray: 200
```

必须提供 `LANGFUSE_BASE_URL`、`LANGFUSE_PUBLIC_KEY`、`LANGFUSE_SECRET_KEY`，三项全部配置后插件才会启用。也可显式设置 `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` 和 `OTEL_EXPORTER_OTLP_HEADERS`；显式 header 优先，日志不会输出密钥或 Authorization。可选变量包括 `LANGFUSE_SERVICE_NAME`、`LANGFUSE_SAMPLE_RATE` 和 `BYCLAW_LANGFUSE_OBSERVATION_BRIDGE_FILE`。

## 安装与启停

```powershell
cd D:\MyProjectGit\ByClawGit\middleware\byclaw-harness\plugins\dsh-langfuse
npm install
npx @deepseek-ai/dsh plugin --profile web add .
npx @deepseek-ai/dsh web --patch "D:\MyProjectGit\ByClawGit\middleware\byclaw-harness\plugins\dsh-langfuse\cordis.patch.yml"
```

修改源码后重启 DSH。依赖未变化时不必重复安装。设置 `enabled: false` 可停用插件。

## 链路语义

- 每个 DSH `sessionId + turn` 是一个 `dsh.run` 请求根，不会跨轮覆盖 Input/Output。
- 只有 `source.kind=user` 的 inbox 消息成为请求输入；技能目录、规则、模型切换通知等注入消息不会冒充用户输入。
- `agent/request` 生成 `dsh.model` generation，记录最终 provider/model、实际事件提供的 token usage、输入消息、system prompt 和工具定义。
- `tools/pre-execute`/`post-execute` 使用同一 execution token 更新一个 `dsh.tool.*` span，内容写入 `input.value`/`output.value`。
- 子代理通过父 Agent 的 scoped event 获取父身份；child session 与父 observation 的 trace context 同时写入内存和文件桥，供另一进程恢复。
- `turn/end` 从 durable `assistant/message` 补写最终输出；晚到的 session/user 属性在结束时再次解析并补写根 trace。
- 采样由根 span 决定，整条树保持一致；关闭时先释放监听器，再等待 ingestion 并 flush/shutdown exporter。

## 验证

```powershell
npm test
```

字段与事件对照见 [MAPPING.zh.md](MAPPING.zh.md)。本地测试不能代替真实 Langfuse 渠道联调；联调报告必须分别记录 OTLP 接收、trace 完成、工具关联、模型 usage 和补写结果。

## 已知差异

DSH 没有 OpenClaw 的统一 diagnostics event 总线，本插件直接适配 DSH 的 host/scoped events。远程子进程必须加载本插件并共享 observation bridge 文件才能继承父 context。DSH 事件不提供的价格或 token 字段不会推算或伪造。
