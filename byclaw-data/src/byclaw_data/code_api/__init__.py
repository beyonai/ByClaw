"""code_api 模块标识，同时暴露 _mount_code_api 供 routes.py 和测试使用。"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def _mount_code_api(app) -> None:
    """将代码查询路由挂载到现有 FastAPI app，无需额外端口。"""
    try:
        from fastapi import APIRouter, Query

        from byclaw_data.code_api.adapter import UnderstandAnythingAdapter
        from byclaw_data.code_api.config import INDEX_PATH

        router = APIRouter(prefix="/code", tags=["code-api"])
        _adapter = UnderstandAnythingAdapter(INDEX_PATH)

        @router.get("/health")
        def health():
            return {"status": "ok", "index_path": str(INDEX_PATH)}

        @router.get("/search/by_object")
        def by_object(object_code: str = Query(..., description="业务对象编码")):
            r = _adapter.find_by_object(object_code)
            return {"results": r, "total": len(r)}

        @router.get("/search/functions")
        def functions(keyword: str = Query(..., description="搜索关键词")):
            r = _adapter.search_functions(keyword)
            return {"results": r, "total": len(r)}

        @router.get("/dependencies")
        def dependencies(file_path: str = Query(..., description="文件相对路径")):
            return _adapter.get_dependencies(file_path)

        app.include_router(router)
        logger.info("[code_api] routes mounted at /code/*")

    except Exception as exc:  # noqa: BLE001
        logger.warning("[code_api] failed to mount routes (indexes may not exist): %s", exc)
