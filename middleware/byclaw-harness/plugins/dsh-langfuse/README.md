# DSH Langfuse

Server-side Langfuse observability plugin for DSH `0.1.5-rc.2`. It observes session, tool, agent and subagent lifecycle events and exports redacted observations through Langfuse public ingestion.

Configure `LANGFUSE_BASE_URL`, `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY`, then add the plugin to a DSH profile with `dsh plugin --profile web add /path/to/plugins/dsh-langfuse`.
