"""独立术语构建服务的 CLI 入口。

调用链路说明：
1. 终端执行 `byclaw-data-term-build` 或 `python -m byclaw_data.term_build_service.main`。
2. `main()` 先读取 `DATACLOUD_TERM_BUILD_*` 环境变量，得到 host / port / log level 等启动配置。
3. `uvicorn.run(..., factory=True)` 启动 FastAPI 工厂函数 `routes:create_app`。
4. `create_app()` 会创建 REST API、Repository 和后台 Worker：
   - `POST /term-jobs` / `GET /term-jobs/{job_id}` / `retry` / `cancel`
   - SQLite 任务表与事件表持久化
   - 后台 worker 轮询并领取 `pending` 任务
5. worker 在执行 `build` 时，会把本地化后的包目录交给
   `datacloud_knowledge.knowledge_build.importer.executor.run()`。
6. `datacloud-knowledge` 再继续走 OWL 解析、字段转换、数据库批量写入的完整导入链路。

也就是说，这个入口本身只负责“启动独立服务”，真正的业务逻辑都在
`routes.py / repository.py / worker.py / executor.py` 中完成。
"""

from __future__ import annotations

import uvicorn

from byclaw_data.term_build_service.settings import get_settings


def main() -> None:
    # 这里只读取本服务自己的配置，不做业务初始化。
    # 业务初始化由 FastAPI factory（routes:create_app）完成，避免入口层和
    # API / Repository / Worker / datacloud-knowledge 导入链路耦合在一起。
    settings = get_settings()
    # 启动独立端口的 Uvicorn 服务：
    # - host / port / log level 都来自 DATACLOUD_TERM_BUILD_* 环境变量
    # - factory=True 表示由字符串导入 FastAPI app factory，而不是直接传 app 对象
    # - 实际创建流程会进入 byclaw_data.term_build_service.routes:create_app
    uvicorn.run(
        "byclaw_data.term_build_service.routes:create_app",
        factory=True,
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level,
    )


if __name__ == "__main__":
    main()
