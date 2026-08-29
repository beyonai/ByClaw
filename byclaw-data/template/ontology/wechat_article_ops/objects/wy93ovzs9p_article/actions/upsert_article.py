"""重写版本（按文档 16.10）：文章 upsert"""
async def execute(params: dict) -> dict:
    project_id = str(params.get("projectId") or "").strip()
    if not project_id:
        return {"records": [{"success": False, "code": "PROJECT_ID_REQUIRED", "error": "projectId不能为空"}], "total": 1, "meta": {"total": 1}}
    account_code = str(params.get("account_code") or "").strip()
    if not account_code:
        return {"records": [{"success": False, "code": "ACCOUNT_CODE_REQUIRED", "error": "account_code不能为空"}], "total": 1, "meta": {"total": 1}}
    import json as _json
    import re as _re
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

    def _write_result(entity, operation, business_key):
        row = {"success": True, "operation": operation,
               "id": _get(entity, "id"), **business_key}
        return _result([row])

    def _writable(params, allowed):
        unknown = [k for k in params if k not in allowed]
        if unknown:
            return None, _error("UNKNOWN_FIELDS", "存在不可写字段", unknown)
        return {k: params[k] for k in allowed if k in params}, None

    allowed = {"id", "title", "publish_time", "url", "canonical_url",
               "content_text", "content_hash", "category", "tags",
               "word_count", "has_video", "has_audio", "collection_id",
               "author", "summary", "projectId", "account_code", "account_name"}
    values, err = _writable(params, allowed)
    if err: return err
    values["projectId"] = project_id
    values["account_code"] = account_code
    account_name = str(params.get("account_name") or "").strip()
    if not account_name:
        return _error("ACCOUNT_NAME_REQUIRED", "account_name不能为空")
    values["account_name"] = account_name
    if not values.get("title") or not values.get("publish_time") or not values.get("canonical_url"):
        return _error("INVALID_ARGUMENT", "title、publish_time和canonical_url不能为空")
    publish_time = str(values["publish_time"]).strip()
    if not _re.fullmatch(r"\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:?\d{2})?", publish_time):
        return _error("INVALID_PUBLISH_TIME", "publish_time必须是精确到秒的ISO-8601时间")
    try:
        values["publish_time"] = _datetime.fromisoformat(
            publish_time.replace("Z", "+00:00")).isoformat(sep=" ", timespec="seconds")
    except ValueError:
        return _error("INVALID_PUBLISH_TIME", "publish_time必须是合法时间")
    if values.get("tags") is not None and not isinstance(values["tags"], str):
        values["tags"] = _json.dumps(values["tags"], ensure_ascii=False)
    if values.get("collection_id"):
        coll = await wy93ovzs9p_article_collection_mapper.select_by_id(values["collection_id"])
        if coll is None or _get(coll, "projectId") != project_id or _get(coll, "account_code") != account_code:
            return _error("COLLECTION_NOT_FOUND", "collection_id对应合集不存在")

    F = Wy93ovzs9pArticle.F
    entity = None
    if values.get("canonical_url"):
        entity = await wy93ovzs9p_article_mapper.select_one(
            Q.eq(F.projectId, project_id).eq(F.account_code, account_code).eq(F.canonical_url, values["canonical_url"]))
    if entity is None and values.get("id"):
        entity = await wy93ovzs9p_article_mapper.select_by_id(values["id"])
        if entity is not None and (_get(entity, "projectId") != project_id or _get(entity, "account_code") != account_code):
            return _error("ACCOUNT_SCOPE_MISMATCH", "文章不属于当前公众号")
    if entity:
        entity_id = _get(entity, "id")
        values.pop("id", None)
        values["id"] = entity_id
        ok = await wy93ovzs9p_article_mapper.update_by_id(
            Wy93ovzs9pArticle(**values))
        if not ok:
            return _error("UPDATE_FAILED", "文章更新失败")
        return _write_result(entity, "updated",
                             {"canonical_url": _get(entity, "canonical_url")})
    values.pop("id", None)
    saved = await wy93ovzs9p_article_mapper.insert(Wy93ovzs9pArticle(**values))
    return _write_result(saved, "inserted",
                         {"canonical_url": _get(saved, "canonical_url")})
