"""按统计日期、文章和渠道获取阅读/分享每日增量。"""


async def execute(params: dict) -> dict:
    import calendar as _calendar
    from datetime import date as _date, datetime as _datetime, timedelta

    MAX_AGGREGATE_ROWS = 50000

    def _result(record):
        return {"records": [record], "total": 1,
                "meta": {"columns": [{"name": key} for key in record], "total": 1}}

    def _error(code, message):
        return _result({"success": False, "code": code, "error": message})

    def _to_date(value):
        if isinstance(value, _datetime):
            return value.date()
        if isinstance(value, _date):
            return value
        if isinstance(value, str) and len(value) == 10:
            try:
                return _date.fromisoformat(value)
            except ValueError:
                return None
        return None

    def _add_months(value, months):
        month_index = value.month - 1 + months
        year = value.year + month_index // 12
        month = month_index % 12 + 1
        day = min(value.day, _calendar.monthrange(year, month)[1])
        return _date(year, month, day)

    def _get(entity, key, default=None):
        return entity.get(key, default) if isinstance(entity, dict) else getattr(entity, key, default)

    def _integer_list(value, name):
        if value is None:
            return None, None
        if not isinstance(value, list) or not value:
            return None, _error("INVALID_ARGUMENT", name + "必须是非空整数数组")
        if any(type(item) is not int for item in value):
            return None, _error("INVALID_ARGUMENT", name + "必须是非空整数数组")
        return sorted(set(value)), None

    async def _fetch_all(build_query, total, batch_size=200):
        result = []
        page_number = 1
        while len(result) < total:
            page_result = await wy93ovzs9p_article_channel_daily_mapper.select(
                build_query().page(page_number, batch_size)
            )
            batch = page_result.get("records", [])
            if not batch:
                break
            result.extend(batch)
            page_number += 1
        return result[:total]

    project_id = str(params.get("projectId") or "").strip()
    account_code = str(params.get("account_code") or "").strip()
    if not project_id:
        return _error("PROJECT_ID_REQUIRED", "projectId不能为空")
    if not account_code:
        return _error("ACCOUNT_CODE_REQUIRED", "account_code不能为空")

    start = _to_date(params.get("stat_date_from"))
    end = _to_date(params.get("stat_date_to"))
    if start is None or end is None or start > end:
        return _error("INVALID_DATE_RANGE", "stat_date_from/stat_date_to必须使用YYYY-MM-DD格式且日期范围为正序")
    if end > _add_months(start, 3):
        return _error("DATE_RANGE_TOO_LARGE", "统计日期范围最多3个自然月，请缩短日期范围")

    article_ids, error = _integer_list(params.get("article_ids"), "article_ids")
    if error:
        return error
    if article_ids is not None and len(article_ids) > 500:
        return _error("TOO_MANY_ARTICLE_IDS", "article_ids最多500个，请分批查询")
    raw_channels = params.get("channels")
    channels = None
    if raw_channels is not None:
        if not isinstance(raw_channels, list) or not raw_channels:
            return _error("INVALID_ARGUMENT", "channels必须是非空字符串数组")
        if any(not isinstance(value, str) for value in raw_channels):
            return _error("INVALID_ARGUMENT", "channels必须是非空字符串数组")
        channels = sorted({value.strip() for value in raw_channels if value.strip()})
        if not channels:
            return _error("INVALID_ARGUMENT", "channels必须是非空字符串数组")

    try:
        page = int(params.get("page", 1))
        page_size = int(params.get("page_size", 100))
    except (TypeError, ValueError):
        return _error("INVALID_ARGUMENT", "page/page_size必须是整数")
    if page < 1 or not 1 <= page_size <= 200:
        return _error("INVALID_ARGUMENT", "page必须>=1且page_size必须在1到200之间")

    CF = Wy93ovzs9pArticleChannelDaily.F
    def _base_query():
        query = (Q.eq(CF.projectId, project_id).eq(CF.account_code, account_code)
                 .eq(CF.metric_mode, "daily_increment")
                 .gte(CF.stat_date, start).lte(CF.stat_date, end))
        if article_ids is not None:
            query = query.in_(CF.article_id, article_ids)
        if channels is not None:
            query = query.in_(CF.channel, channels)
        return (query.order_by(CF.stat_date, desc=False)
                .order_by(CF.article_id, desc=False)
                .order_by(CF.channel, desc=False).order_by(CF.id, desc=False))

    total_matched = await wy93ovzs9p_article_channel_daily_mapper.count(_base_query())
    rows = (await wy93ovzs9p_article_channel_daily_mapper.select(
        _base_query().page(page, page_size)
    )).get("records", [])
    aggregate_returned = page == 1
    if aggregate_returned and total_matched > MAX_AGGREGATE_ROWS:
        return _error("RESULT_TOO_LARGE", "渠道指标超过50000行，请缩短日期范围或使用article_ids/channels缩小范围")
    aggregate_rows = await _fetch_all(_base_query, total_matched) if aggregate_returned else []
    if aggregate_returned and len(aggregate_rows) != total_matched:
        return _error("INCOMPLETE_PAGE", "渠道数据分页未完整返回，请稍后重试")

    returned_ids = sorted({
        _get(row, "article_id") for row in rows + aggregate_rows
        if _get(row, "article_id") is not None
    })
    metadata_ids = sorted(set(returned_ids) | set(article_ids or []))
    if len(metadata_ids) > 5000:
        return _error("TOO_MANY_ARTICLES", "聚合涉及文章超过5000篇，请缩短日期范围或使用article_ids缩小范围")
    articles = []
    AF = Wy93ovzs9pArticle.F
    for offset in range(0, len(metadata_ids), 200):
        id_batch = metadata_ids[offset:offset + 200]
        article_query = (Q.eq(AF.projectId, project_id).eq(AF.account_code, account_code)
                         .in_(AF.id, id_batch).limit(len(id_batch)))
        articles.extend((await wy93ovzs9p_article_mapper.select(article_query)).get("records", []))
    article_by_id = {_get(row, "id"): row for row in articles}

    items = []
    for row in rows:
        article_id = _get(row, "article_id")
        article = article_by_id.get(article_id)
        channel = _get(row, "channel")
        read_count = _get(row, "read_count")
        share_count = _get(row, "share_count")
        items.append({
            "article_id": article_id,
            "title": _get(article, "title"),
            "publish_time": _get(article, "publish_time"),
            "stat_date": str(_get(row, "stat_date")),
            "metric_mode": "daily_increment",
            "channel": channel,
            "read_count": read_count,
            "share_count": share_count,
        })
    summaries = {}
    article_channel_summaries = {}
    dates_by_article_channel = {}
    any_dates_by_article = {}
    for row in aggregate_rows:
        article_id = _get(row, "article_id")
        row_date = str(_to_date(_get(row, "stat_date")))
        any_dates_by_article.setdefault(article_id, set()).add(row_date)
        channel = _get(row, "channel")
        dates_by_article_channel.setdefault((article_id, channel), set()).add(row_date)
        read_count = _get(row, "read_count")
        share_count = _get(row, "share_count")
        summary = summaries.setdefault(channel, {
            "channel": channel,
            "read_count": 0,
            "share_count": 0,
            "missing_read_count": 0,
            "missing_share_count": 0,
        })
        article_summary = article_channel_summaries.setdefault((article_id, channel), {
            "article_id": article_id, "channel": channel,
            "read_count": 0, "share_count": 0,
            "missing_read_count": 0, "missing_share_count": 0,
        })
        if read_count is None:
            summary["missing_read_count"] += 1
            article_summary["missing_read_count"] += 1
        else:
            summary["read_count"] += read_count
            article_summary["read_count"] += read_count
        if share_count is None:
            summary["missing_share_count"] += 1
            article_summary["missing_share_count"] += 1
        else:
            summary["share_count"] += share_count
            article_summary["share_count"] += share_count

    for summary in list(summaries.values()) + list(article_channel_summaries.values()):
        if summary["missing_read_count"]:
            summary["read_count"] = None
        if summary["missing_share_count"]:
            summary["share_count"] = None

    coverage_by_article = []
    aggregate_article_ids = article_ids if article_ids is not None else sorted(any_dates_by_article)
    coverage_channels = channels if channels is not None else (
        sorted(summaries, key=lambda value: (value != "全部", value or "")) or ["全部"]
    )
    for article_id in aggregate_article_ids:
        article = article_by_id.get(article_id)
        publish_date = _to_date(_get(article, "publish_time"))
        expected_start = max(start, publish_date) if publish_date is not None else start
        expected_dates = {
            str(expected_start + timedelta(days=offset))
            for offset in range((end - expected_start).days + 1)
        }
        for channel in coverage_channels:
            observed_dates = dates_by_article_channel.get((article_id, channel), set())
            coverage_by_article.append({
                "article_id": article_id,
                "channel": channel,
                "status": (
                    "no_channel_rows" if not observed_dates
                    else "complete_dates" if observed_dates == expected_dates
                    else "sparse_or_missing_days"
                ),
                "observed_dates": sorted(observed_dates),
                "missing_calendar_dates": sorted(expected_dates - observed_dates),
            })

    coverage_by_channel = {}
    coverage_status_by_key = {}
    for item in coverage_by_article:
        coverage_by_channel.setdefault(item["channel"], []).append(item["status"])
        coverage_status_by_key[(item["article_id"], item["channel"])] = item["status"]
    for channel, summary in summaries.items():
        statuses = coverage_by_channel.get(channel, [])
        complete = bool(statuses) and all(status == "complete_dates" for status in statuses)
        summary["coverage_status"] = "complete_dates" if complete else "partial"
        summary["observed_read_count"] = summary["read_count"]
        summary["observed_share_count"] = summary["share_count"]
        if not complete:
            summary["read_count"] = None
            summary["share_count"] = None
    for key, summary in article_channel_summaries.items():
        complete = coverage_status_by_key.get(key) == "complete_dates"
        summary["coverage_status"] = "complete_dates" if complete else "partial"
        summary["observed_read_count"] = summary["read_count"]
        summary["observed_share_count"] = summary["share_count"]
        if not complete:
            summary["read_count"] = None
            summary["share_count"] = None

    if total_matched:
        data_status = "available"
    elif article_ids is not None or channels is not None:
        data_status = "no_matching_filter"
    else:
        data_status = "no_data"

    return _result({
        "success": True,
        "data_status": data_status,
        "period": {"stat_date_from": str(start), "stat_date_to": str(end)},
        "metric_mode": "daily_increment",
        "items": items,
        "available_channels": sorted(summaries, key=lambda value: (value != "全部", value or "")),
        "summary_by_channel": [summaries[key] for key in sorted(summaries, key=lambda value: (value != "全部", value or ""))],
        "summary_by_article_channel": [article_channel_summaries[key] for key in sorted(
            article_channel_summaries,
            key=lambda value: (value[0], value[1] != "全部", value[1] or ""),
        )],
        "summary_scope": "requested_period_with_coverage" if aggregate_returned else "not_returned",
        "aggregate_returned": aggregate_returned,
        "coverage_by_article": coverage_by_article,
        "total_matched": total_matched,
        "page": page,
        "page_size": page_size,
    })
