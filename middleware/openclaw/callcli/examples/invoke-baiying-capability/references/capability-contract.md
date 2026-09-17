# Capability contract

Complete this file during Skill development. Never write a session ID, URL, token, cookie, header,
Redis configuration, or private parameter here.

- Resource ID: `REPLACE_WITH_RESOURCE_ID`
- Resource type: `MCP`
- Action: `REPLACE_WITH_ACTION`
- Contract version: `REPLACE_WITH_VERSION`
- Input mapping: business query -> `arguments.keyword`
- Side effects: none expected; confirm from the resource owner
- Idempotent: yes; confirm before enabling retries

Discovery commands for development:

```bash
callcli resource list --session-id "$dev_session_id" --resource-type MCP --keyword "业务资源"
callcli resource describe --session-id "$dev_session_id" --resource-id RESOURCE_ID --resource-type MCP
callcli describe invoke --format json
```

If discovery returns zero resources, stop. If it returns multiple candidates, narrow by the documented
business constraint or ask the user; never choose the first result. At runtime, `callcli invoke`
rechecks authorization before execution.

