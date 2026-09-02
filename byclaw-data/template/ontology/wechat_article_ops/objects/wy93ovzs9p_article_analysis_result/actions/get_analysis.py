"""重写版本：查询分析结果"""
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
        if entity is None: return default
        if isinstance(entity, dict): return entity.get(key, default)
        return getattr(entity, key, default)

    def _result(records):
        columns = [{"name": k} for k in records[0].keys()] if records else []
        return {"records": records, "total": len(records),
                "meta": {"columns": columns, "total": len(records)}}

    def _error(code, message, details=None):
        return _result([{"success": False, "code": code, "error": message,
                         "details": details or []}])

    def _to_date(v):
        if v is None: return v
        if isinstance(v, _datetime): return v.date()
        if isinstance(v, _date): return v
        if isinstance(v, str):
            try: return _date.fromisoformat(v[:10])
            except ValueError: return v
        return v

    def _str(v):
        if v is None: return None
        if isinstance(v, (_date, _datetime)): return v.isoformat()
        return str(v)

    def _json_value(v):
        if not isinstance(v, str): return v
        try: return _json.loads(v)
        except (ValueError, _json.JSONDecodeError): return v

    analysis_id = params.get("analysis_id")
    if not analysis_id:
        return _error("INVALID_ARGUMENT", "analysis_id不能为空")
    entity = await wy93ovzs9p_article_analysis_result_mapper.select_by_id(analysis_id)
    if entity is None or _get(entity, "projectId") != project_id or _get(entity, "account_code") != account_code:
        return _error("ANALYSIS_NOT_FOUND", "分析结果不存在")

    row = {
        "success": True,
        "id": _get(entity, "id"), "run_id": _get(entity, "run_id"),
        "analysis_type": _get(entity, "analysis_type"),
        "analysis_stage": _get(entity, "analysis_stage"),
        "source_run_id": _get(entity, "source_run_id"),
        "platform": _get(entity, "platform"),
        "content_role": _get(entity, "content_role"),
        "topic": _get(entity, "topic"),
        "target_audience": _get(entity, "target_audience"),
        "audience_fit_analysis": _json_value(_get(entity, "audience_fit_analysis")),
        "recommended_publish_time": _get(entity, "recommended_publish_time"),
        "recommended_keywords": _json_value(_get(entity, "recommended_keywords")),
        "publishing_execution_card": _json_value(_get(entity, "publishing_execution_card")),
        "desired_action": _get(entity, "desired_action"),
        "tested_element": _get(entity, "tested_element"),
        "learning_outcome": _get(entity, "learning_outcome"),
        "article_id": _get(entity, "article_id"),
        "collection_id": _get(entity, "collection_id"),
        "stat_date": _str(_to_date(_get(entity, "stat_date"))),
        "period_start": _str(_to_date(_get(entity, "period_start"))),
        "period_end": _str(_to_date(_get(entity, "period_end"))),
        "rating": _get(entity, "rating"),
        "structured_result": _get(entity, "structured_result"),
        "external_benchmarks": _get(entity, "external_benchmarks"),
        "review_result": _get(entity, "review_result"),
        "status": _get(entity, "status"),
        "report_format": _get(entity, "report_format"),
        "report_html": _get(entity, "report_html"),
    }
    # 兼容 created_at / updated_at (如果 mapper 暴露则加进去)
    for k in ("created_at", "updated_at"):
        v = _get(entity, k)
        if v is not None:
            row[k] = _str(v)
    return _result([row])
