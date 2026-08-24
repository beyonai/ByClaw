"""重写版本：文章每日指标 upsert"""
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

    def _safe_div(a, b):
        if a is None or b is None or b == 0: return None
        return a / b

    raw_fields = {
        "read_count", "avg_stay_sec", "finish_rate", "new_follow_count",
        "share_count", "wow_count", "like_count", "favorite_count",
        "comment_count", "deliver_count", "msg_read_count",
        "first_share_count", "share_driven_read", "listen_full_count",
        "reward_points",
    }
    allowed = {"article_id", "stat_date", "source_batch_id",
               "metric_rule_version"} | raw_fields
    values, err = _writable(params, allowed)
    if err: return err
    if not values.get("article_id") or not values.get("stat_date"):
        return _error("INVALID_ARGUMENT", "article_id和stat_date不能为空")

    article_id = values["article_id"]
    stat_date = _to_date(values["stat_date"])
    if not isinstance(stat_date, _date):
        return _error("INVALID_ARGUMENT", "stat_date必须是合法日期字符串")

    art = await wy93ovzs9p_article_mapper.select_by_id(article_id)
    if art is None:
        return _error("ARTICLE_NOT_FOUND", "article_id对应文章不存在")
    for name in raw_fields:
        if values.get(name) is not None and values[name] < 0:
            return _error("INVALID_METRIC", name + "不能小于0")
    if values.get("finish_rate") is not None and values["finish_rate"] > 1:
        return _error("INVALID_METRIC", "finish_rate必须在0到1之间")

    F = Wy93ovzs9pArticleMetricDaily.F
    q = Q.eq(F.article_id, article_id).eq(F.stat_date, stat_date)
    entity = await wy93ovzs9p_article_metric_daily_mapper.select_one(q)

    def _metric_value(name):
        if name in values: return values[name]
        return _get(entity, name) if entity else None

    values["open_rate"] = _safe_div(_metric_value("msg_read_count"), _metric_value("deliver_count"))
    values["share_rate"] = _safe_div(_metric_value("share_count"), _metric_value("read_count"))
    values["follow_rate"] = _safe_div(_metric_value("new_follow_count"), _metric_value("read_count"))
    values["virality_factor"] = _safe_div(_metric_value("share_driven_read"), _metric_value("share_count"))
    values["stat_date"] = stat_date

    key = {"article_id": article_id, "stat_date": str(stat_date)}
    if entity:
        entity_id = _get(entity, "id")
        values["id"] = entity_id
        ok = await wy93ovzs9p_article_metric_daily_mapper.update_by_id(
            Wy93ovzs9pArticleMetricDaily(**values))
        if not ok: return _error("UPDATE_FAILED", "文章指标更新失败")
        return _write_result(entity, "updated", key)
    values.pop("id", None)
    saved = await wy93ovzs9p_article_metric_daily_mapper.insert(
        Wy93ovzs9pArticleMetricDaily(**values))
    return _write_result(saved, "inserted", key)