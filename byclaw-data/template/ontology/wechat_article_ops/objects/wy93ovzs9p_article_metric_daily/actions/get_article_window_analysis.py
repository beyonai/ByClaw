"""新增 Action（按文档 16.3）：7/30天窗口分析"""
async def execute(params: dict) -> dict:
    project_id = str(params.get("projectId") or "").strip()
    if not project_id:
        return {"records": [{"success": False, "code": "PROJECT_ID_REQUIRED", "error": "projectId不能为空"}], "total": 1, "meta": {"total": 1}}
    account_code = str(params.get("account_code") or "").strip()
    if not account_code:
        return {"records": [{"success": False, "code": "ACCOUNT_CODE_REQUIRED", "error": "account_code不能为空"}], "total": 1, "meta": {"total": 1}}
    import json as _json
    from datetime import date as _date, datetime as _datetime, timedelta

    def _to_date(v):
        if v is None: return v
        if isinstance(v, _datetime): return v.date()
        if isinstance(v, _date): return v
        if isinstance(v, str):
            try: return _date.fromisoformat(v[:10])
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

    def _safe_div(a, b):
        if a is None or b is None or b == 0: return None
        return a / b

    article_id = params.get("article_id")
    raw_windows = params.get("window_days") or [7, 30]
    try:
        window_days = sorted({int(d) for d in raw_windows})
    except Exception:
        return _error("INVALID_ARGUMENT", "window_days 必须是整数数组")
    as_of_value = params.get("as_of_date")
    requested_mode = params.get("channel_metric_mode")

    if not article_id:
        return _error("INVALID_ARGUMENT", "article_id不能为空")
    if any(days not in (7, 30) for days in window_days):
        return _error("INVALID_WINDOW_DAYS", "window_days只允许7和30")
    if requested_mode not in (None, "daily_increment", "cumulative"):
        return _error("INVALID_METRIC_MODE", "channel_metric_mode不合法")

    article = await wy93ovzs9p_article_mapper.select_by_id(article_id)
    if article is None or _get(article, "projectId") != project_id or _get(article, "account_code") != account_code:
        return _error("ARTICLE_NOT_FOUND", "文章不存在")
    publish_time = _get(article, "publish_time")
    if publish_time is None:
        return _error("DATA_NOT_READY", "文章没有发布时间")
    if isinstance(publish_time, _datetime):
        publish_date = publish_time.date()
    elif isinstance(publish_time, str):
        publish_date = _date.fromisoformat(publish_time[:10])
    else:
        publish_date = publish_time

    as_of_date = _to_date(as_of_value) if as_of_value else None
    if as_of_value and not isinstance(as_of_date, _date):
        return _error("INVALID_ARGUMENT", "as_of_date必须是合法日期")

    MF = Wy93ovzs9pArticleMetricDaily.F
    latest_query = (Q.eq(MF.projectId, project_id).eq(MF.account_code, account_code).eq(MF.article_id, article_id)
                    .order_by(MF.stat_date, "desc").limit(1))
    if as_of_date:
        latest_query = latest_query.lte(MF.stat_date, as_of_date)
    latest_metric = await wy93ovzs9p_article_metric_daily_mapper.select_one(latest_query)
    if latest_metric is None:
        return _error("DATA_NOT_READY", "文章没有可用指标")
    effective_as_of = as_of_date or _to_date(_get(latest_metric, "stat_date"))

    windows = []
    for days in window_days:
        target_date = publish_date + timedelta(days=days - 1)
        visible_target = min(target_date, effective_as_of)
        metric_query = (Q.eq(MF.projectId, project_id).eq(MF.account_code, account_code).eq(MF.article_id, article_id)
                        .lte(MF.stat_date, visible_target)
                        .order_by(MF.stat_date, "desc").limit(1))
        metric = await wy93ovzs9p_article_metric_daily_mapper.select_one(metric_query)
        if metric is None:
            windows.append({
                "window_days": days, "target_stat_date": str(target_date),
                "actual_stat_date": None, "window_complete": False,
                "subscription_funnel": None, "share_diffusion": None,
                "channel_distribution": None, "missing_fields": ["article_metric_daily"],
            })
            continue

        deliver = _get(metric, "deliver_count")
        msg_read = _get(metric, "msg_read_count")
        first_share = _get(metric, "first_share_count")
        share_count = _get(metric, "share_count")
        share_driven = _get(metric, "share_driven_read")
        metric_stat_date = _to_date(_get(metric, "stat_date"))

        CF = Wy93ovzs9pArticleChannelDaily.F
        channel_query = (Q.eq(CF.projectId, project_id).eq(CF.account_code, account_code).eq(CF.article_id, article_id)
                         .gte(CF.stat_date, publish_date)
                         .lte(CF.stat_date, visible_target)
                         .limit(1000))
        channel_page = await wy93ovzs9p_article_channel_daily_mapper.select(channel_query)
        channel_rows = channel_page.get("records", [])
        available_modes = {_get(row, "metric_mode") for row in channel_rows}
        mode = requested_mode
        if mode is None:
            mode = ("daily_increment" if "daily_increment" in available_modes
                    else ("cumulative" if "cumulative" in available_modes else None))
        channel_rows = [row for row in channel_rows
                        if _get(row, "metric_mode") == mode
                        and _get(row, "channel") != "全部"]

        channel_totals = {}
        if mode == "daily_increment":
            for row in channel_rows:
                ch = _get(row, "channel")
                item = channel_totals.setdefault(ch, {"read_count": 0, "share_count": 0})
                item["read_count"] += _get(row, "read_count") or 0
                item["share_count"] += _get(row, "share_count") or 0
        elif mode == "cumulative":
            latest_by_channel = {}
            for row in sorted(channel_rows, key=lambda x: _to_date(_get(x, "stat_date"))):
                latest_by_channel[_get(row, "channel")] = row
            channel_totals = {
                ch: {"read_count": _get(row, "read_count") or 0,
                     "share_count": _get(row, "share_count") or 0}
                for ch, row in latest_by_channel.items()
            }

        total_channel_read = sum(x["read_count"] for x in channel_totals.values())
        channel_items = [
            {"channel": ch, **vals,
             "read_share": _safe_div(vals["read_count"], total_channel_read)}
            for ch, vals in sorted(channel_totals.items())
        ]
        missing = [name for name, value in {
            "deliver_count": deliver, "msg_read_count": msg_read,
            "first_share_count": first_share, "share_count": share_count,
            "share_driven_read": share_driven,
        }.items() if value is None]
        windows.append({
            "window_days": days,
            "target_stat_date": str(target_date),
            "actual_stat_date": str(metric_stat_date),
            "window_complete": (effective_as_of >= target_date
                                and metric_stat_date >= target_date),
            "subscription_funnel": {
                "deliver_count": deliver, "msg_read_count": msg_read,
                "first_share_count": first_share,
                "message_open_rate": _safe_div(msg_read, deliver),
                "first_share_rate": _safe_div(first_share, msg_read),
            },
            "share_diffusion": {
                "share_count": share_count, "share_driven_read": share_driven,
                "share_read_efficiency": _safe_div(share_driven, share_count),
            },
            "channel_distribution": {
                "metric_mode": mode, "total_read_count": total_channel_read,
                "items": channel_items,
            },
            "missing_fields": missing,
        })

    return _result([{
        "success": True, "article_id": article_id,
        "publish_date": str(publish_date), "as_of_date": str(effective_as_of),
        "windows": windows,
    }])
