# callcli

`callcli` 是供业务 Skill 脚本调用百应平台能力的纯 Python CLI。它通过平台服务发现查询当前会话
可使用资源，调用前再次校验授权，然后按精确类型执行 TOOL、TOOLKIT、MCP 或远程 AGENT。

第一版明确不支持 PAGE、DOC、OBJECT、VIEW 和 ASK_PERSONAL。

## 安装

Python 3.11+：

```bash
python -m pip install dist/byclaw_callcli-0.1.0-py3-none-any.whl
callcli --version
```

平台运行环境还需提供 `by_framework`。服务实例只能由服务发现解析，CLI 不接受 endpoint 参数。

## 配置

平台负责注入：

- `CALLCLI_RESOURCE_SERVICE`，未配置时兼容 `BE_DOMAINNAME`；
- `Beyond-Token` 或兼容的 `BEYOND_TOKEN`，以及可选的 `SSO_TOKEN`、`SYSTEM_CODE`、`USER_CODE`；
- `DATACLOUD_GATEWAY_REDIS_*` 或兼容的 `REDIS_*`。

这些值不得由 Skill 接收、记录或输出。开发测试可用 `CALLCLI_RESOURCE_SNAPSHOT_DIR` 指向资源快照
目录；生产环境不应设置它。

## 使用

```bash
callcli describe --all --format json

callcli resource list \
  --session-id "$session_id" \
  --resource-type MCP \
  --keyword "搜索"

callcli resource describe \
  --session-id "$session_id" \
  --resource-id 10001 \
  --resource-type MCP

callcli invoke \
  --session-id "$session_id" \
  --resource-id 10001 \
  --resource-type MCP \
  --action search \
  --arguments '{"keyword":"新能源汽车"}'
```

`TOOLKIT` 和 `MCP` 必须先执行 `resource describe`，从本次返回的 `actions`/`tools`
中选择精确名称，并依据对应的 `inputSchema` 构造参数。`invoke` 必须显式传入
`--action`，即使资源当前只有一个工具也不会自动选择。`--query` 仅适用于 `AGENT`；
`TOOL`、`TOOLKIT` 和 `MCP` 使用 `--arguments`。

所有正常输出和错误均为机器可读 JSON；`--stream` 使用 NDJSON 事件。业务 Skill 的开发约束和
完整示例见 [AGENT_SKILL_DEVELOPMENT.md](AGENT_SKILL_DEVELOPMENT.md) 与
[`examples/invoke-baiying-capability`](examples/invoke-baiying-capability)。

## 开发验证

```bash
PYTHONPATH=src python -m unittest discover -s tests -v
python -m compileall -q src tests examples
```

集成验证需由平台测试环境提供服务发现、Redis 和有效运行时会话。不要把浏览器 Cookie、签名或会话
Token 写入测试文件。
