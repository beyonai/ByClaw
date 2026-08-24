"""重写版本（按文档 16.5）：合集分析上下文"""
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

    collection_id = params.get("collection_id")
    stat_date = _to_date(params.get("stat_date"))
    if not collection_id:
        return _error("INVALID_ARGUMENT", "collection_id不能为空")
    if stat_date and not isinstance(stat_date, _date):
        return _error("INVALID_ARGUMENT", "stat_date必须是合法日期字符串")

    collection = await wy93ovzs9p_article_collection_mapper.select_by_id(collection_id)
    if not collection:
        return _error("COLLECTION_NOT_FOUND", "合集不存在")

    AF = Wy93ovzs9pArticle.F
    page = await wy93ovzs9p_article_mapper.select(
        Q.eq(AF.collection_id, collection_id).order_by(AF.publish_time, "desc").limit(500))
    articles = page.get("records", [])
    MF = Wy93ovzs9pArticleMetricDaily.F
    items = []
    for article in articles:
        mq = Q.eq(MF.article_id, _get(article, "id"))
        mq = (mq.eq(MF.stat_date, stat_date) if stat_date else
              mq.order_by(MF.stat_date, "desc").limit(1))
        metric = await wy93ovzs9p_article_metric_daily_mapper.select_one(mq)
        stat_d = _get(metric, "stat_date")
        items.append({
            "article_id": _get(article, "id"), "title": _get(article, "title"),
            "publish_time": _get(article, "publish_time"),
            "metric_stat_date": str(stat_d) if stat_d else None,
            "read_count": _get(metric, "read_count"),
            "share_count": _get(metric, "share_count"),
            "new_follow_count": _get(metric, "new_follow_count"),
        })

    coll_dict = {
        "id": _get(collection, "id"),
        "name": _get(collection, "collection_name"),
        "description": _get(collection, "description"),
    }

    return _result([{
        "success": True,
        "collection": coll_dict,
        "requested_stat_date": str(stat_date) if stat_date else None,
        "articles": items,
        "summary": {
            "article_count": len(items),
            "total_read_count": sum((x["read_count"] or 0) for x in items),
            "total_share_count": sum((x["share_count"] or 0) for x in items),
            "total_new_follow_count": sum((x["new_follow_count"] or 0) for x in items),
        },
    }])