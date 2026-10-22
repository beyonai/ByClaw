# DSH Langfuse plugin

Server-side Langfuse tracing for `beyonai/byclaw-harness` branch `2026.9.8` and DSH `0.2.0-rc.2`. It exports request, model, tool, and subagent observations through OpenTelemetry OTLP HTTP/protobuf. Langfuse public ingestion is used only to backfill final root-trace input/output and session/user identity.

Required environment variables are `LANGFUSE_BASE_URL`, `LANGFUSE_PUBLIC_KEY`, and `LANGFUSE_SECRET_KEY`; the plugin is enabled only when all three are configured. `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `LANGFUSE_SERVICE_NAME`, `LANGFUSE_SAMPLE_RATE`, and `BYCLAW_LANGFUSE_OBSERVATION_BRIDGE_FILE` are optional. Credentials and authorization headers are never logged.

Install dependencies with `npm install`, add the package to the DSH profile, and restart DSH after source changes. Run `npm test` for the behavior tests. See [MAPPING.zh.md](MAPPING.zh.md) for the DSH-to-Langfuse mapping and known platform differences.
