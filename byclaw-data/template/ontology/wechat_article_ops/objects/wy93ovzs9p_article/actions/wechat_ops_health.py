async def execute(params: dict) -> dict:
    project_id = str(params.get("projectId") or "").strip()
    if not project_id:
        return {"records": [{"success": False, "code": "PROJECT_ID_REQUIRED", "error": "projectId不能为空"}], "total": 1, "meta": {"total": 1}}
    return {
        "records": [{"success": True, "status": "ok"}],
        "total": 1,
        "meta": {"columns": [{"name": "success"}, {"name": "status"}], "total": 1}
    }