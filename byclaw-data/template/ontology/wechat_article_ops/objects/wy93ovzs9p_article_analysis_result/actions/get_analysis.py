"""重写版本：查询分析结果"""
async def execute(params: dict) -> dict:
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

    analysis_id = params.get("analysis_id")
    if not analysis_id:
        return _error("INVALID_ARGUMENT", "analysis_id不能为空")
    entity = await wy93ovzs9p_article_analysis_result_mapper.select_by_id(analysis_id)
    if entity is None:
        return _error("ANALYSIS_NOT_FOUND", "分析结果不存在")

    row = {
        "success": True,
        "id": _get(entity, "id"), "run_id": _get(entity, "run_id"),
        "analysis_type": _get(entity, "analysis_type"),
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