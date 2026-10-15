# DSH Langfuse 事件探针（临时）

这是为 Langfuse 插件设计准备的最小 DSH 探针。它只监听候选生命周期事件，输出事件名、有限深度的字段形状和脱敏后的少量内容；不连接 Langfuse、不发送网络请求、不修改事件结果。

## 使用

镜像构建只挂载声明了 `dsh.bundle.patch` 的插件。本插件已去掉该字段，重新构建的沙箱 profile 不会包含 `@byclaw/dsh-langfuse-probe`。

需要临时诊断时，先把 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` 加回 `package.json`，再把插件目录加入 DSH profile：

```sh
dsh plugin --profile web add /path/to/byclaw-dsh/plugins/dsh-langfuse-probe
dsh --profile web web
```

执行普通对话、工具调用和子 Agent 后，在 DSH 日志中搜索 `[langfuse-probe]`。日志只用于确认 DSH 0.1.5-rc.2 实际发出的事件和字段，不能作为 Langfuse 导出结果。

## 安全与限制

- 默认只记录事件摘要，字符串最多 300 字符、对象最多 3 层和 30 个字段。
- key 名称匹配 token、secret、password、authorization、apiKey、cookie、credential 时替换为 `[redacted]`。
- 这不是安全边界；事件内容仍可能包含业务数据，测试时应使用隔离会话和脱敏数据。
- 这是一次性探针，不应作为正式生产插件部署。
