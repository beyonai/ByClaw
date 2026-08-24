async def execute(params: dict) -> dict:
    return {
        "records": [{"success": True, "status": "ok"}],
        "total": 1,
        "meta": {"columns": [{"name": "success"}, {"name": "status"}], "total": 1}
    }