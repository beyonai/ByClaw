"""重写版本：用户画像每日数据 upsert"""
async def execute(params: dict) -> dict:
    import json as _json
    from datetime import date as _date, datetime as _datetime

    def _to_date(v):
        if v is None: return v
        if isinstance(v, _datetime): return v.date()
        if isinstance(v, _date): return v
        if isinstance(v, str):
            s = v[:10]
            try: return _date.fromisoformat(s)
            except ValueError: return v
        return v

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

    def _valid_distribution(value):
        if value is None: return True
        if isinstance(value, dict):
            items = value.values()
        elif isinstance(value, str):
            try:
                parsed = _json.loads(value)
                if isinstance(parsed, dict):
                    items = parsed.values()
                else:
                    items = [x.get("share") for x in parsed]
            except Exception:
                return False
        else:
            try:
                items = [x.get("share") for x in value]
            except Exception:
                return False
        shares = [x for x in items if x is not None]
        return (all(0 <= x <= 1 for x in shares)
                and (not shares or 0.99 <= sum(shares) <= 1.01))

    allowed = {"article_id", "stat_date", "gender_distribution", "age_distribution",
               "region_distribution", "sample_size", "source_batch_id"}
    values, err = _writable(params, allowed)
    if err: return err
    if not values.get("article_id") or not values.get("stat_date"):
        return _error("INVALID_ARGUMENT", "article_id和stat_date不能为空")

    article_id = values["article_id"]
    stat_date = _to_date(values["stat_date"])
    if not isinstance(stat_date, _date):
        return _error("INVALID_ARGUMENT", "stat_date必须是合法日期字符串")
    values["stat_date"] = stat_date

    for name in ("gender_distribution", "age_distribution", "region_distribution"):
        if not _valid_distribution(values.get(name)):
            return _error("INVALID_DISTRIBUTION", name + "占比不合法")
        if values.get(name) is not None and not isinstance(values[name], str):
            values[name] = _json.dumps(values[name], ensure_ascii=False)

    if values.get("sample_size") is not None and values["sample_size"] < 0:
        return _error("INVALID_ARGUMENT", "sample_size不能小于0")

    art = await wy93ovzs9p_article_mapper.select_by_id(article_id)
    if art is None:
        return _error("ARTICLE_NOT_FOUND", "article_id对应文章不存在")

    F = Wy93ovzs9pArticleUserProfileDaily.F
    q = Q.eq(F.article_id, article_id).eq(F.stat_date, stat_date)
    entity = await wy93ovzs9p_article_user_profile_daily_mapper.select_one(q)
    key = {"article_id": article_id, "stat_date": str(stat_date)}
    if entity:
        entity_id = _get(entity, "id")
        values["id"] = entity_id
        ok = await wy93ovzs9p_article_user_profile_daily_mapper.update_by_id(
            Wy93ovzs9pArticleUserProfileDaily(**values))
        if not ok: return _error("UPDATE_FAILED", "用户画像更新失败")
        return _write_result(entity, "updated", key)
    values.pop("id", None)
    saved = await wy93ovzs9p_article_user_profile_daily_mapper.insert(
        Wy93ovzs9pArticleUserProfileDaily(**values))
    return _write_result(saved, "inserted", key)