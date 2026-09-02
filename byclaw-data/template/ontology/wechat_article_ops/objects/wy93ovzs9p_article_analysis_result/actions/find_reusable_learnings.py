"""检索已批准的发布后复盘知识，供发布前诊断复用。"""
async def execute(params: dict) -> dict:
    project_id = str(params.get("projectId") or "").strip()
    if not project_id:
        return {"records": [{"success": False, "code": "PROJECT_ID_REQUIRED", "error": "projectId不能为空"}], "total": 1, "meta": {"total": 1}}
    account_code = str(params.get("account_code") or "").strip()
    if not account_code:
        return {"records": [{"success": False, "code": "ACCOUNT_CODE_REQUIRED", "error": "account_code不能为空"}], "total": 1, "meta": {"total": 1}}
    import json as _json
    from datetime import date as _date, datetime as _datetime

    def _get(entity, key, default=None):
        if entity is None:
            return default
        if isinstance(entity, dict):
            return entity.get(key, default)
        return getattr(entity, key, default)

    def _text(value):
        return str(value).strip() if value is not None else ""

    def _json_value(value):
        if not isinstance(value, str):
            return value
        try:
            return _json.loads(value)
        except (ValueError, _json.JSONDecodeError):
            return value

    def _serializable(value):
        if isinstance(value, (_date, _datetime)):
            return value.isoformat()
        return value

    filters = {
        name: _text(params.get(name))
        for name in ("platform", "content_role", "topic", "target_audience", "desired_action", "tested_element", "learning_outcome")
    }
    if not any(filters.values()):
        return {"records": [{"success": False, "code": "INVALID_ARGUMENT", "error": "至少提供一个复用筛选条件"}], "total": 1, "meta": {"total": 1}}
    try:
        limit = int(params.get("limit", 20))
    except (TypeError, ValueError):
        limit = 20
    limit = min(max(limit, 1), 100)

    F = Wy93ovzs9pArticleAnalysisResult.F
    q = Q.eq(F.projectId, project_id).eq(F.account_code, account_code).eq(F.status, "approved").eq(F.analysis_stage, "post_publish")
    for name in ("platform", "content_role", "desired_action", "tested_element", "learning_outcome"):
        if filters[name]:
            q = q.eq(getattr(F, name), filters[name])
    for name in ("topic", "target_audience"):
        if filters[name]:
            safe = filters[name].replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            q = q.like(getattr(F, name), f"%{safe}%")
    q = q.order_by(F.stat_date, desc=True).order_by(F.id, desc=True).limit(limit)
    rows = await wy93ovzs9p_article_analysis_result_mapper.select(q)
    records = rows.get("records", []) if isinstance(rows, dict) else rows
    items = []
    for row in records or []:
        items.append({
            "analysis_id": _get(row, "id"),
            "run_id": _get(row, "run_id"),
            "source_run_id": _get(row, "source_run_id"),
            "article_id": _get(row, "article_id"),
            "platform": _get(row, "platform"),
            "content_role": _get(row, "content_role"),
            "topic": _get(row, "topic"),
            "target_audience": _get(row, "target_audience"),
            "audience_fit_analysis": _json_value(_get(row, "audience_fit_analysis")),
            "recommended_publish_time": _get(row, "recommended_publish_time"),
            "recommended_keywords": _json_value(_get(row, "recommended_keywords")),
            "publishing_execution_card": _json_value(_get(row, "publishing_execution_card")),
            "desired_action": _get(row, "desired_action"),
            "tested_element": _get(row, "tested_element"),
            "learning_outcome": _get(row, "learning_outcome"),
            "stat_date": _serializable(_get(row, "stat_date")),
            "structured_result": _json_value(_get(row, "structured_result")),
            "knowledge_resource_id": _get(row, "knowledge_resource_id"),
            "knowledge_file_path": _get(row, "knowledge_file_path"),
        })
    return {"records": [{"success": True, "items": items, "total": len(items)}], "total": 1, "meta": {"total": 1}}
