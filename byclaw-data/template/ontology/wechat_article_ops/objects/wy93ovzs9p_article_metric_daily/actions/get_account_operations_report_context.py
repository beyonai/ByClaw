"""聚合 account-ops-v2 所需的确定性事实，不生成运营建议。"""
async def execute(params: dict) -> dict:
    project_id = str(params.get("projectId") or "").strip()
    if not project_id:
        return {"records": [{"success": False, "code": "PROJECT_ID_REQUIRED", "error": "projectId不能为空"}], "total": 1, "meta": {"total": 1}}
    from datetime import date as _date, datetime as _datetime, timedelta as _timedelta

    def _get(entity, key, default=None):
        if entity is None: return default
        if isinstance(entity, dict): return entity.get(key, default)
        return getattr(entity, key, default)

    def _to_date(value):
        if isinstance(value, _datetime): return value.date()
        if isinstance(value, _date): return value
        if isinstance(value, str):
            try: return _date.fromisoformat(value[:10])
            except ValueError: return None
        return None

    def _result(row):
        return {"records": [row], "total": 1,
                "meta": {"columns": [{"name": k} for k in row], "total": 1}}

    account_code = str(params.get("account_code") or "").strip()
    account_name = str(params.get("account_name") or "").strip()
    end = _to_date(params.get("data_as_of"))
    report_date = _to_date(params.get("report_date")) or (end + _timedelta(days=1) if end else None)
    days = params.get("trend_days", 30)
    if not account_code or not account_name or end is None:
        return _result({"success": False, "code": "INVALID_ARGUMENT",
                        "error": "account_code、account_name和data_as_of不能为空"})
    if not isinstance(days, int) or days < 7 or days > 90:
        return _result({"success": False, "code": "INVALID_TREND_DAYS",
                        "error": "trend_days必须在7到90之间"})

    AF = Wy93ovzs9pArticle.F
    article_page = await wy93ovzs9p_article_mapper.select(
        Q.eq(AF.projectId, project_id).eq(AF.account_code, account_code).order_by(AF.publish_time, "desc").limit(2000))
    articles = article_page.get("records", [])
    MF = Wy93ovzs9pArticleMetricDaily.F
    metric_fields = {
        "read": "read_count", "share": "share_count", "like": "like_count",
        "favorite": "favorite_count", "comment": "comment_count",
        "wow": "wow_count",
    }

    async def _metric(article_id, target):
        q = (Q.eq(MF.projectId, project_id).eq(MF.account_code, account_code).eq(MF.article_id, article_id)
             .lte(MF.stat_date, target).order_by(MF.stat_date, "desc").limit(1))
        return await wy93ovzs9p_article_metric_daily_mapper.select_one(q)

    offsets = [0, 1, 7, 30]
    snapshots = {}
    for article in articles:
        article_id = _get(article, "id")
        snapshots[article_id] = {}
        for offset in offsets:
            snapshots[article_id][offset] = await _metric(article_id, end - _timedelta(days=offset))

    def _sum(offset, field):
        values = [_get(by_offset[offset], field) for by_offset in snapshots.values()
                  if by_offset.get(offset) is not None]
        return None if not values else sum(value or 0 for value in values)

    labels = {"read": "总阅读", "share": "总分享", "like": "总点赞",
              "favorite": "总收藏", "comment": "总留言"}
    metric_cards = []
    for code in ("read", "share", "like", "favorite", "comment"):
        field = metric_fields[code]; current = _sum(0, field)
        card = {"metric_code": code, "label": labels[code],
                "current_value": current, "metric_mode": "account_article_cumulative",
                "unit": "人", "actual_stat_date": str(end)}
        for offset in (1, 7, 30):
            prior = _sum(offset, field)
            card[f"delta_{offset}d"] = None if current is None or prior is None else current - prior
        metric_cards.append(card)

    FF = Wy93ovzs9pAccountFollowerDaily.F
    async def _follower(target):
        q = (Q.eq(FF.projectId, project_id).eq(FF.account_code, account_code).lte(FF.stat_date, target)
             .order_by(FF.stat_date, "desc").limit(1))
        return await wy93ovzs9p_account_follower_daily_mapper.select_one(q)
    follower_rows = {offset: await _follower(end - _timedelta(days=offset)) for offset in offsets}
    current_follower = _get(follower_rows[0], "follower_count")
    follower_summary = {"follower_count": current_follower,
                        "new_follow_count": _get(follower_rows[0], "new_follow_count"),
                        "unfollow_count": _get(follower_rows[0], "unfollow_count"),
                        "net_follow_count": _get(follower_rows[0], "net_follow_count"),
                        "actual_stat_date": str(_get(follower_rows[0], "stat_date")) if follower_rows[0] else None}
    for offset in (1, 7, 30):
        prior = _get(follower_rows[offset], "follower_count")
        follower_summary[f"delta_{offset}d"] = None if current_follower is None or prior is None else current_follower - prior
    follow_card = {"metric_code": "follow", "label": "新增关注",
                   "current_value": follower_summary["new_follow_count"],
                   "metric_mode": "daily_increment", "unit": "人",
                   "actual_stat_date": follower_summary["actual_stat_date"]}
    for offset in (1, 7, 30):
        row = follower_rows[offset]
        prior = _get(row, "new_follow_count")
        follow_card[f"delta_{offset}d"] = None if follow_card["current_value"] is None or prior is None else follow_card["current_value"] - prior
    metric_cards.append(follow_card)

    start = end - _timedelta(days=days - 1)
    dates = [start + _timedelta(days=index) for index in range(days)]
    trend_series = {"dates": [day.strftime("%m-%d") for day in dates]}
    previous_totals = {code: None for code in metric_fields}
    for code, field in metric_fields.items(): trend_series[code] = []
    trend_series["follow"] = []
    for day in dates:
        day_totals = {}
        for code, field in metric_fields.items():
            values = []
            for article in articles:
                metric = await _metric(_get(article, "id"), day)
                if metric is not None: values.append(_get(metric, field) or 0)
            total = None if not values else sum(values); day_totals[code] = total
            previous = previous_totals[code]
            trend_series[code].append(None if total is None or previous is None else total - previous)
            previous_totals[code] = total
        follower = await _follower(day)
        trend_series["follow"].append(_get(follower, "new_follow_count"))

    month_start = end.replace(day=1)
    works = []
    for article in articles:
        article_id = _get(article, "id"); current = snapshots[article_id][0]; prior = snapshots[article_id][1]
        published = str(_get(article, "publish_time") or "")
        published_month = _to_date(published)
        deltas = {}
        for code, field in metric_fields.items():
            current_value = _get(current, field); prior_value = _get(prior, field)
            deltas[code] = None if current_value is None or prior_value is None else current_value - prior_value
        reasons = []
        if published_month is not None and month_start <= published_month <= end: reasons.append("本月发布作品")
        if any(value not in (None, 0) for value in deltas.values()): reasons.append("今日有数据波动")
        if not reasons: continue
        works.append({"article_id": article_id, "title": _get(article, "title"),
                      "url": _get(article, "url") or _get(article, "canonical_url"),
                      "publish_time": published,
                      "metrics": {code: _get(current, field) for code, field in metric_fields.items()},
                      "deltas_1d": deltas, "selection_reasons": reasons})
    works.sort(key=lambda item: (item["metrics"].get("read") or -1), reverse=True)

    missing = []
    if follower_rows[0] is None: missing.append("follower_summary")
    if not articles: missing.extend(["metric_cards", "trend_series", "works"])
    CF = Wy93ovzs9pArticleChannelDaily.F
    channel_totals = {}
    for article in articles:
        q = (Q.eq(CF.projectId, project_id).eq(CF.account_code, account_code).eq(CF.article_id, _get(article, "id"))
             .eq(CF.metric_mode, "cumulative").lte(CF.stat_date, end)
             .order_by(CF.stat_date, "desc").limit(50))
        page = await wy93ovzs9p_article_channel_daily_mapper.select(q)
        latest_by_channel = {}
        for row in page.get("records", []):
            channel = _get(row, "channel")
            if channel and channel not in latest_by_channel: latest_by_channel[channel] = row
        for channel, row in latest_by_channel.items():
            if channel == "全部": continue
            channel_totals[channel] = channel_totals.get(channel, 0) + (_get(row, "read_count") or 0)
    channel_sum = sum(channel_totals.values())
    channel_summary = {
        "metric_mode": "cumulative", "data_as_of": str(end),
        "channels": [{"channel": channel, "read_count": value,
                      "share": None if channel_sum == 0 else value / channel_sum}
                     for channel, value in sorted(channel_totals.items(), key=lambda item: item[1], reverse=True)]
    } if channel_totals else None
    if channel_summary is None: missing.append("channel_summary")

    publish_groups = {}
    for article in articles:
        published = str(_get(article, "publish_time") or "")
        try: published_dt = _datetime.fromisoformat(published.replace("Z", "+00:00"))
        except ValueError: continue
        metric = snapshots.get(_get(article, "id"), {}).get(0)
        read_count = _get(metric, "read_count")
        if read_count is None: continue
        key = f"{published_dt.weekday()}-{published_dt.hour:02d}"
        group = publish_groups.setdefault(key, {"weekday": published_dt.weekday(),
                                                "hour": published_dt.hour,
                                                "article_count": 0, "total_read_count": 0})
        group["article_count"] += 1; group["total_read_count"] += read_count
    publish_time_summary = None
    if publish_groups:
        groups = []
        for group in publish_groups.values():
            groups.append({**group, "average_read_count": group["total_read_count"] / group["article_count"]})
        groups.sort(key=lambda item: item["average_read_count"], reverse=True)
        publish_time_summary = {"data_as_of": str(end), "groups": groups}
    else: missing.append("publish_time_summary")
    return _result({"success": True,
                    "account": {"projectId": project_id,
                                "account_code": account_code, "account_name": account_name,
                                "platform": "公众号", "home_url": params.get("home_url")},
                    "period": {"report_date": str(report_date), "data_as_of": str(end),
                               "period_start": str(start), "period_end": str(end)},
                    "follower_summary": follower_summary, "metric_cards": metric_cards,
                    "trend_series": trend_series, "works": works,
                    "channel_summary": channel_summary,
                    "publish_time_summary": publish_time_summary,
                    "missing_outputs": sorted(set(missing))})
