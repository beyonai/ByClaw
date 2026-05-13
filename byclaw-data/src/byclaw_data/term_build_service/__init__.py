"""独立异步术语构建服务包。

这个包和 `byclaw_data.mcp` 平级，不挂载到 MCP JSON-RPC 服务里，而是通过
`byclaw_data.term_build_service.main` 启动独立端口的 FastAPI 服务。

对外只暴露 `create_app`，方便 Uvicorn factory、测试代码或其他启动器复用。
具体调用链路是：
`main.py` 启动服务 -> `routes.py` 创建 API / Repository / Worker ->
`worker.py` 领取任务 -> `executor.py` 调用 datacloud-knowledge 完成 OWL 导入。
"""

from byclaw_data.term_build_service.routes import create_app

__all__ = ["create_app"]
