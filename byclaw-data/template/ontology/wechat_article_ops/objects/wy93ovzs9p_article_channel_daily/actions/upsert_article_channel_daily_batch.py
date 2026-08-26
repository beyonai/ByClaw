"""重写版本：渠道每日数据批量 upsert"""
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

    async def _safe_select_by_id(mapper_fn, entity_id):
        try:
            return await mapper_fn(entity_id)
        except Exception:
            return None

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

    article_id = params.get("article_id")
    stat_date_raw = params.get("stat_date")
    metric_mode = params.get("metric_mode")
    raw_items = params.get("items") or []
    if not article_id or not stat_date_raw or not raw_items:
        return _error("INVALID_ARGUMENT", "article_id、stat_date和items不能为空")
    items = raw_items
    if isinstance(raw_items, str):
        try:
            items = _json.loads(raw_items)
        except (TypeError, ValueError):
            items = None
    if not isinstance(items, list):
        return _error("INVALID_ITEM", "items必须是JSON数组字符串或对象列表")
    invalid_items = [index for index, item in enumerate(items)
                     if not isinstance(item, dict)]
    if invalid_items:
        return _error("INVALID_ITEM", "items数组中的每一项必须是对象", invalid_items)
    if metric_mode not in ("cumulative", "daily_increment"):
        return _error("INVALID_METRIC_MODE", "metric_mode仅支持cumulative或daily_increment")
    art = await _safe_select_by_id(wy93ovzs9p_article_mapper.select_by_id, article_id)
    if art is None:
        return _error("ARTICLE_NOT_FOUND", "article_id对应文章不存在")
    if len({item.get("channel") for item in items}) != len(items):
        return _error("DUPLICATE_CHANNEL", "items中channel不能重复")

    stat_date = _to_date(stat_date_raw)
    if not isinstance(stat_date, _date):
        return _error("INVALID_ARGUMENT", "stat_date必须是合法日期字符串")

    F = Wy93ovzs9pArticleChannelDaily.F
    allowed_channels = {"全部", "公众号消息", "公众号会话", "朋友圈",
                        "搜一搜", "公众号主页", "聊天会话", "推荐", "其他"}
    rows = []
    for index, item in enumerate(items):
        channel = item.get("channel")
        if channel not in allowed_channels:
            rows.append({"success": False, "operation": "failed", "index": index,
                         "code": "INVALID_CHANNEL", "error": "channel不在允许枚举中"})
            continue
        values = {"article_id": article_id, "stat_date": stat_date,
                  "metric_mode": metric_mode, "channel": channel,
                  "read_count": item.get("read_count"),
                  "share_count": item.get("share_count")}
        if any(values.get(name) is not None and values[name] < 0
               for name in ("read_count", "share_count")):
            rows.append({"success": False, "operation": "failed", "index": index,
                         "channel": channel, "code": "INVALID_METRIC",
                         "error": "渠道指标不能小于0"})
            continue
        q = (Q.eq(F.article_id, article_id).eq(F.stat_date, stat_date)
             .eq(F.channel, channel).eq(F.metric_mode, metric_mode))
        entity = await wy93ovzs9p_article_channel_daily_mapper.select_one(q)
        if entity:
            entity_id = _get(entity, "id")
            values["id"] = entity_id
            ok = await wy93ovzs9p_article_channel_daily_mapper.update_by_id(
                Wy93ovzs9pArticleChannelDaily(**values))
            if not ok:
                rows.append({"success": False, "operation": "failed", "index": index,
                             "channel": channel, "code": "UPDATE_FAILED",
                             "error": "渠道指标更新失败"})
                continue
            operation = "updated"
            saved_id = entity_id
        else:
            values.pop("id", None)
            saved = await wy93ovzs9p_article_channel_daily_mapper.insert(
                Wy93ovzs9pArticleChannelDaily(**values))
            operation = "inserted"
            saved_id = _get(saved, "id")
        rows.append({"success": True, "operation": operation, "id": saved_id,
                     "article_id": article_id, "stat_date": str(stat_date),
                     "channel": channel, "metric_mode": metric_mode})

    response = _result(rows)
    response["meta"]["write_summary"] = {
        "inserted": sum(x.get("operation") == "inserted" for x in rows),
        "updated": sum(x.get("operation") == "updated" for x in rows),
        "failed": sum(x.get("success") is False for x in rows),
    }
    return response
