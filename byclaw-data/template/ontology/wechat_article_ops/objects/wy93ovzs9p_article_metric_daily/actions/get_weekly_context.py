async def execute(params: dict) -> dict:
    project_id = str(params.get("projectId") or "").strip()
    if not project_id:
        return {"records": [{"success": False, "code": "PROJECT_ID_REQUIRED", "error": "projectId不能为空"}], "total": 1, "meta": {"total": 1}}
    account_code = str(params.get("account_code") or "").strip()
    if not account_code:
        return {"records": [{"success": False, "code": "ACCOUNT_CODE_REQUIRED", "error": "account_code不能为空"}], "total": 1, "meta": {"total": 1}}
    from datetime import date as _date, datetime as _datetime

    def _to_date(v):
        if v is None: return v
        if isinstance(v, _datetime): return v.date()
        if isinstance(v, _date): return v
        if isinstance(v, str):
            try: return _date.fromisoformat(v[:10])
            except ValueError: return v
        return v

    def _result(records):
        columns = [{"name": k} for k in records[0].keys()] if records else []
        return {"records": records, "total": len(records), "meta": {"columns": columns, "total": len(records)}}

    def _error(code, message):
        return _result([{"success": False, "code": code, "error": message}])

    def _safe_div(a, b):
        if a is None or b is None or b == 0: return None
        return a / b

    def _get(entity, key, default=None):
        """兼容 entity 对象和 dict"""
        if entity is None: return default
        if isinstance(entity, dict): return entity.get(key, default)
        return getattr(entity, key, default)

    start = _to_date(params.get("start"))
    end = _to_date(params.get("end"))
    as_of_date = _to_date(params.get("as_of_date")) or end
    compare = params.get("compare", "previous")

    if not isinstance(start, _date) or not isinstance(end, _date):
        return _error("INVALID_DATE_RANGE", "start/end不能为空且必须为合法日期")
    if start > end:
        return _error("INVALID_DATE_RANGE", "start不得晚于end")
    if not isinstance(as_of_date, _date):
        return _error("INVALID_DATE_RANGE", "as_of_date必须是合法日期")

    AF = Wy93ovzs9pArticle.F
    aq = (Q.eq(AF.projectId, project_id).eq(AF.account_code, account_code).gte(AF.publish_time, str(start))
          .lte(AF.publish_time, str(end))
          .order_by(AF.publish_time, "desc").limit(500))
    article_page = await wy93ovzs9p_article_mapper.select(aq)
    articles = article_page.get("records", [])

    MF = Wy93ovzs9pArticleMetricDaily.F
    items = []
    for article in articles:
        mq = (Q.eq(MF.projectId, project_id).eq(MF.account_code, account_code).eq(MF.article_id, _get(article, "id")).lte(MF.stat_date, as_of_date)
              .order_by(MF.stat_date, "desc").limit(1))
        metric = await wy93ovzs9p_article_metric_daily_mapper.select_one(mq)
        stat_date = _get(metric, "stat_date")
        items.append({
            "article_id": _get(article, "id"),
            "title": _get(article, "title"),
            "publish_time": _get(article, "publish_time"),
            "metric_stat_date": str(stat_date) if stat_date else None,
            "read_count": _get(metric, "read_count"),
            "deliver_count": _get(metric, "deliver_count"),
            "msg_read_count": _get(metric, "msg_read_count"),
            "share_count": _get(metric, "share_count"),
            "new_follow_count": _get(metric, "new_follow_count"),
            "finish_rate": _get(metric, "finish_rate"),
        })

    present = [x for x in items if x["metric_stat_date"] is not None]
    def _sum_field(name):
        return sum((x[name] or 0) for x in present)

    summary = {
        "article_count": len(articles),
        "metric_ready_count": len(present),
        "total_read_count": _sum_field("read_count"),
        "total_new_follow_count": _sum_field("new_follow_count"),
        "weighted_open_rate": _safe_div(_sum_field("msg_read_count"), _sum_field("deliver_count")),
        "weighted_share_rate": _safe_div(_sum_field("share_count"), _sum_field("read_count")),
    }

    return _result([{
        "success": True,
        "period": {"start": str(start), "end": str(end)},
        "as_of_date": str(as_of_date),
        "summary": summary,
        "articles": items,
        "compare": compare,
        "comparison": None,
    }])
