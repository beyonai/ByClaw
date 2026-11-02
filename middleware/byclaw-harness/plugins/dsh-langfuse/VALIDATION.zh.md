# Langfuse 验证记录

## 2026-10-15 受控导出验证

- 配置来源：本机 DSH `.env`；仅检查变量存在性，未输出凭证或 Authorization。
- 路径：`OtelExporter` 通过 OTLP HTTP/protobuf 写入一个验证 span，随后 `LangfuseIngestion` 以相同 trace ID 补写根 trace。
- trace ID：`90c65dcfebd3c9f98a8f41e3e53cd908`
- Public Ingestion：成功。
- Public Trace API 回读：HTTP 200，trace ID 匹配。
- observations：1。

该结果确认当前 Langfuse 地址、鉴权、OTLP/protobuf 接收、public ingestion 及 trace ID 对齐可用。它不等同于完整 DSH 业务验收；模型、工具、子代理和终态链路须在重启 DSH、加载本次插件代码后以真实会话继续验证。
