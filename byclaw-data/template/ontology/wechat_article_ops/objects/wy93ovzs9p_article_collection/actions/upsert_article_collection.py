"""重写版本（按文档 16.10）：合集 upsert"""
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

    def _to_date(v):
        if v is None: return v
        if isinstance(v, _datetime): return v.date()
        if isinstance(v, _date): return v
        if isinstance(v, str):
            s = v[:10]
            try: return _date.fromisoformat(s)
            except ValueError: return v
        return v

    def _result(records):
        columns = [{"name": k} for k in records[0].keys()] if records else []
        return {"records": records, "total": len(records),
                "meta": {"columns": columns, "total": len(records)}}

    def _error(code, message, details=None):
        return _result([{"success": False, "code": code, "error": message,
                         "details": details or []}])

    def _write_result(entity, operation, business_key):
        row = {"success": True, "operation": operation,
               "id": _get(entity, "id"), **business_key}
        return _result([row])

    def _writable(params, allowed):
        unknown = [k for k in params if k not in allowed]
        if unknown:
            return None, _error("UNKNOWN_FIELDS", "存在不可写字段", unknown)
        return {k: params[k] for k in allowed if k in params}, None

    allowed = {"id", "collection_name", "collection_type", "start_date",
               "end_date", "category", "target", "description", "status", "projectId", "account_code", "account_name"}
    values, err = _writable(params, allowed)
    if err: return err
    values["projectId"] = project_id
    values["account_code"] = account_code
    account_name = str(params.get("account_name") or "").strip()
    if not account_name:
        return _error("ACCOUNT_NAME_REQUIRED", "account_name不能为空")
    values["account_name"] = account_name
    if not values.get("collection_name") or not values.get("collection_type"):
        return _error("INVALID_ARGUMENT", "collection_name和collection_type不能为空")

    for k in ("start_date", "end_date"):
        if values.get(k) is not None:
            d = _to_date(values[k])
            if not isinstance(d, _date):
                return _error("INVALID_ARGUMENT", k + "必须是合法日期字符串")
            values[k] = d

    F = Wy93ovzs9pArticleCollection.F
    entity = None
    if values.get("collection_name") and values.get("collection_type"):
        entity = await wy93ovzs9p_article_collection_mapper.select_one(
            Q.eq(F.projectId, project_id).eq(F.account_code, account_code).eq(F.collection_name, values["collection_name"])
             .eq(F.collection_type, values["collection_type"]))
    if entity is None and values.get("id"):
        entity = await wy93ovzs9p_article_collection_mapper.select_by_id(values["id"])
        if entity is not None and (_get(entity, "projectId") != project_id or _get(entity, "account_code") != account_code):
            return _error("ACCOUNT_SCOPE_MISMATCH", "合集不属于当前公众号")

    if entity:
        entity_id = _get(entity, "id")
        values.pop("id", None)
        values["id"] = entity_id
        ok = await wy93ovzs9p_article_collection_mapper.update_by_id(
            Wy93ovzs9pArticleCollection(**values))
        if not ok:
            return _error("UPDATE_FAILED", "合集更新失败")
        return _write_result(entity, "updated",
                             {"collection_name": _get(entity, "collection_name")})
    values.pop("id", None)
    saved = await wy93ovzs9p_article_collection_mapper.insert(
        Wy93ovzs9pArticleCollection(**values))
    return _write_result(saved, "inserted",
                         {"collection_name": _get(saved, "collection_name")})
