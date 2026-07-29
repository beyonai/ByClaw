# 会话空间文件读取参考

Action 脚本中需要读取用户上传到会话空间的文件（如 CSV、文本等）时，使用本模式。

## 路径格式

| 格式 | 说明 |
|------|------|
| `/.session/123456/data.csv` | 完整路径，session_id 自动提取 |
| `/data.csv` | 相对路径，需由调用方额外传入 session_id（通常从 `context.session_id` 获取） |

## 完整模板

```python
async def execute(params: dict) -> dict:
    import os, re
    from redis.asyncio import Redis
    from by_framework.core.discovery import DiscoveryClient
    from by_framework.util.discovery_http_client import DiscoveryHttpClient
    from by_framework.util.http_client import RetryConfig

    file_path = params.get("file_path", "")
    if not file_path:
        return {"records": [{"success": False, "error": "缺少文件路径参数 file_path"}],
                "total": 1, "meta": {"columns": [{"name": "success"}, {"name": "error"}], "total": 1}}

    user_code = context.user_id if context else os.getenv("USER_CODE", "")
    session_id = getattr(context, "session_id", "") or ""

    # ── 规范化路径，支持 /.session/<id>/<path> 格式 ──
    normalized = file_path
    match = re.search(r"/\.sessions?/(\d+)/(.*)", normalized)
    if match:
        if not session_id:
            session_id = match.group(1)
        normalized = "/" + match.group(2)

    # ── 通过服务发现读取文件 ──
    redis_client = Redis(
        host=os.getenv("DATACLOUD_GATEWAY_REDIS_HOST", "localhost"),
        port=int(os.getenv("DATACLOUD_GATEWAY_REDIS_PORT", 6379)),
        db=int(os.getenv("DATACLOUD_GATEWAY_REDIS_DB", 0)),
        password=os.getenv("DATACLOUD_GATEWAY_REDIS_PASSWORD") or None,
        username=os.getenv("DATACLOUD_GATEWAY_REDIS_USERNAME") or None,
        decode_responses=True,
    )
    discovery_client = DiscoveryClient(redis_client=redis_client, cache_interval=5)
    retry_config = RetryConfig(max_attempts=3, retry_on_status_codes={502, 503, 504})
    try:
        async with DiscoveryHttpClient(discovery_client, retry_config=retry_config) as client:
            response = await client.post(
                "ByaiService",
                "/byaiService/open/api/v1/conversation/read",
                headers={"Content-Type": "application/json"},
                json={"userCode": user_code, "sessionId": session_id,
                      "filePath": normalized, "begin_line": 0, "end_line": -1},
            )
    finally:
        await discovery_client.close()
        await redis_client.aclose()

    if not response.is_success:
        return {"records": [{"success": False, "error": f"文件读取失败：{response.data}"}],
                "total": 1, "meta": {"columns": [{"name": "success"}, {"name": "error"}], "total": 1}}

    # ── 提取文本内容 ──
    raw = response.data
    if isinstance(raw, str):
        content = raw
    elif isinstance(raw, dict):
        content = raw.get("content") or ""
        if not content:
            nested = raw.get("data") or {}
            if isinstance(nested, dict):
                content = nested.get("content") or ""
    else:
        content = ""

    if not content:
        return {"records": [{"success": False, "error": f"文件内容为空：{file_path}"}],
                "total": 1, "meta": {"columns": [{"name": "success"}, {"name": "error"}], "total": 1}}

    # content 即文件的完整文本内容，后续按需解析（如 CSV、JSON 等）
    # 示例：CSV 解析
    # import csv, io
    # reader = csv.DictReader(io.StringIO(content))
    # rows = list(reader)
```

## 注意事项

- 此模式适用于需要读取用户上传文件的场景（如批量导入），会绕过 mapper 层直接调用内部服务
- 参数 `file_path` 需在 `collect_action.py` 的 `params` 中声明为 `input` 类型
- `begin_line` / `end_line` 支持分片读取，`end_line: -1` 表示读到末尾
- `context` 对象由平台注入，无需 import
