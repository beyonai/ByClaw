# ruff: noqa: F821 -- 对象类、mapper 与 Q 由 Action 运行时注入。
"""聚合 account-ops-v2 所需的确定性事实，不生成运营建议。"""


async def execute(params: dict) -> dict:
    from bisect import bisect_right
    from datetime import date as _date, datetime as _datetime, timedelta as _timedelta

    def _get(entity, key, default=None):
        if entity is None:
            return default
        if isinstance(entity, dict):
            return entity.get(key, default)
        return getattr(entity, key, default)

    def _to_date(value):
        if isinstance(value, _datetime):
            return value.date()
        if isinstance(value, _date):
            return value
        if isinstance(value, str):
            try:
                return _date.fromisoformat(value[:10])
            except ValueError:
                return None
        return None

    def _result(row):
        return {
            "records": [row],
            "total": 1,
            "meta": {"columns": [{"name": key} for key in row], "total": 1},
        }

    project_id = str(params.get("projectId") or "").strip()
    account_code = str(params.get("account_code") or "").strip()
    requested_end = _to_date(params.get("data_as_of"))
    end = requested_end
    explicit_report_date = _to_date(params.get("report_date"))
    days = params.get("trend_days", 30)
    if not project_id:
        return _result({
            "success": False,
            "code": "PROJECT_ID_REQUIRED",
            "error": "projectId不能为空",
        })
    if not account_code or end is None:
        return _result({
            "success": False,
            "code": "INVALID_ARGUMENT",
            "error": "account_code和data_as_of不能为空",
        })
    if not isinstance(days, int) or days < 7 or days > 90:
        return _result({
            "success": False,
            "code": "INVALID_TREND_DAYS",
            "error": "trend_days必须在7到90之间",
        })

    AF = Wy93ovzs9pArticle.F
    article_page = await wy93ovzs9p_article_mapper.select(
        Q.eq(AF.projectId, project_id)
        .eq(AF.account_code, account_code)
        .order_by(AF.publish_time, "desc")
        .limit(2000)
    )
    articles = article_page.get("records", [])
    article_by_id = {_get(article, "id"): article for article in articles}

    MF = Wy93ovzs9pArticleMetricDaily.F
    metric_page = await wy93ovzs9p_article_metric_daily_mapper.select(
        Q.eq(MF.projectId, project_id)
        .eq(MF.account_code, account_code)
        .lte(MF.stat_date, end)
        .order_by(MF.stat_date)
        .limit(200000)
    )
    metrics = metric_page.get("records", [])

    FF = Wy93ovzs9pAccountFollowerDaily.F
    follower_page = await wy93ovzs9p_account_follower_daily_mapper.select(
        Q.eq(FF.projectId, project_id)
        .eq(FF.account_code, account_code)
        .lte(FF.stat_date, end)
        .order_by(FF.stat_date)
        .limit(1000)
    )
    followers = follower_page.get("records", [])

    CF = Wy93ovzs9pArticleChannelDaily.F
    channel_page = await wy93ovzs9p_article_channel_daily_mapper.select(
        Q.eq(CF.projectId, project_id)
        .eq(CF.account_code, account_code)
        .lte(CF.stat_date, end)
        .order_by(CF.stat_date)
        .limit(200000)
    )
    channels = channel_page.get("records", [])

    COF = Wy93ovzs9pArticleCollection.F
    collection_page = await wy93ovzs9p_article_collection_mapper.select(
        Q.eq(COF.projectId, project_id)
        .eq(COF.account_code, account_code)
        .limit(2000)
    )
    collections = collection_page.get("records", [])
    collection_by_id = {
        _get(collection, "id"): collection for collection in collections
    }

    available_fact_dates = [
        fact_date
        for rows in (metrics, followers, channels)
        for row in rows
        for fact_date in [_to_date(_get(row, "stat_date"))]
        if fact_date is not None and fact_date <= requested_end
    ]
    if available_fact_dates:
        end = max(available_fact_dates)
    report_date = explicit_report_date or end + _timedelta(days=1)

    account_names = [
        str(_get(row, "account_name") or "").strip()
        for rows in (articles, followers, metrics, channels)
        for row in rows
        if str(_get(row, "account_name") or "").strip()
    ]
    if not account_names:
        return _result({
            "success": False,
            "code": "ACCOUNT_NOT_FOUND",
            "error": "未找到该项目与账号编码对应的账号名称",
        })
    account_name = account_names[0]

    metric_fields = {
        "read": "read_count",
        "share": "share_count",
        "like": "like_count",
        "favorite": "favorite_count",
        "comment": "comment_count",
        "wow": "wow_count",
    }
    metrics_by_article = {}
    exact_metric_dates = set()
    for row in metrics:
        article_id = _get(row, "article_id")
        stat_date = _to_date(_get(row, "stat_date"))
        if article_id is None or stat_date is None:
            continue
        metrics_by_article.setdefault(article_id, []).append((stat_date, row))
        exact_metric_dates.add(stat_date)
    metric_dates_by_article = {}
    for article_id, rows in metrics_by_article.items():
        rows.sort(key=lambda item: item[0])
        metric_dates_by_article[article_id] = [item[0] for item in rows]

    def _metric_as_of(article_id, target):
        rows = metrics_by_article.get(article_id, [])
        dates = metric_dates_by_article.get(article_id, [])
        index = bisect_right(dates, target) - 1
        return rows[index][1] if index >= 0 else None

    article_ids = sorted(set(article_by_id) | set(metrics_by_article))
    offsets = (0, 1, 7, 30)
    snapshots = {
        article_id: {
            offset: _metric_as_of(article_id, end - _timedelta(days=offset))
            for offset in offsets
        }
        for article_id in article_ids
    }

    def _sum_snapshot(offset, field):
        values = [
            _get(by_offset.get(offset), field)
            for by_offset in snapshots.values()
            if by_offset.get(offset) is not None
        ]
        return None if not values else sum(value or 0 for value in values)

    labels = {
        "read": "总阅读",
        "share": "总分享",
        "like": "总点赞",
        "favorite": "总收藏",
        "comment": "总留言",
    }
    metric_cards = []
    for code in ("read", "share", "like", "favorite", "comment"):
        field = metric_fields[code]
        current = _sum_snapshot(0, field)
        card = {
            "metric_code": code,
            "label": labels[code],
            "current_value": current,
            "metric_mode": "account_article_cumulative",
            "unit": "人",
            "actual_stat_date": str(end),
        }
        for offset in (1, 7, 30):
            prior = _sum_snapshot(offset, field)
            card[f"delta_{offset}d"] = (
                None if current is None or prior is None else current - prior
            )
        metric_cards.append(card)

    follower_rows = []
    for row in followers:
        stat_date = _to_date(_get(row, "stat_date"))
        if stat_date is not None:
            follower_rows.append((stat_date, row))
    follower_rows.sort(key=lambda item: item[0])
    follower_dates = [item[0] for item in follower_rows]
    follower_exact = {item[0]: item[1] for item in follower_rows}

    def _follower_as_of(target):
        index = bisect_right(follower_dates, target) - 1
        return follower_rows[index][1] if index >= 0 else None

    follower_by_offset = {
        offset: _follower_as_of(end - _timedelta(days=offset)) for offset in offsets
    }
    current_follower_row = follower_by_offset[0]
    current_follower = _get(current_follower_row, "follower_count")
    follower_summary = {
        "follower_count": current_follower,
        "new_follow_count": _get(current_follower_row, "new_follow_count"),
        "unfollow_count": _get(current_follower_row, "unfollow_count"),
        "net_follow_count": _get(current_follower_row, "net_follow_count"),
        "actual_stat_date": (
            str(_get(current_follower_row, "stat_date"))
            if current_follower_row is not None
            else None
        ),
    }
    for offset in (1, 7, 30):
        prior = _get(follower_by_offset[offset], "follower_count")
        follower_summary[f"delta_{offset}d"] = (
            None if current_follower is None or prior is None else current_follower - prior
        )
    follow_card = {
        "metric_code": "follow",
        "label": "新增关注",
        "current_value": follower_summary["new_follow_count"],
        "metric_mode": "daily_increment",
        "unit": "人",
        "actual_stat_date": follower_summary["actual_stat_date"],
    }
    for offset in (1, 7, 30):
        prior = _get(follower_by_offset[offset], "new_follow_count")
        follow_card[f"delta_{offset}d"] = (
            None
            if follow_card["current_value"] is None or prior is None
            else follow_card["current_value"] - prior
        )
    metric_cards.append(follow_card)

    start = end - _timedelta(days=days - 1)
    dates = [start + _timedelta(days=index) for index in range(days)]
    trend_series = {"dates": [day.strftime("%m-%d") for day in dates]}
    daily_channel_totals = {
        "read": {},
        "share": {},
    }
    daily_channels_by_article = {}
    for row in channels:
        if (
            _get(row, "metric_mode") != "daily_increment"
            or _get(row, "channel") != "全部"
        ):
            continue
        stat_date = _to_date(_get(row, "stat_date"))
        if stat_date is None:
            continue
        for code, field in (("read", "read_count"), ("share", "share_count")):
            value = _get(row, field)
            if value is not None:
                by_date = daily_channel_totals[code]
                by_date[stat_date] = by_date.get(stat_date, 0) + value
                article_id = _get(row, "article_id")
                if article_id is not None:
                    article_values = daily_channels_by_article.setdefault(
                        article_id, {"read": {}, "share": {}}
                    )[code]
                    article_values[stat_date] = article_values.get(stat_date, 0) + value

    for code, field in metric_fields.items():
        if code in daily_channel_totals:
            trend_series[code] = [
                daily_channel_totals[code].get(day) for day in dates
            ]
            continue
        totals = []
        for day in dates:
            if day not in exact_metric_dates:
                totals.append(None)
                continue
            values = [
                _get(_metric_as_of(article_id, day), field)
                for article_id in article_ids
                if _metric_as_of(article_id, day) is not None
            ]
            totals.append(None if not values else sum(value or 0 for value in values))
        trend_series[code] = [
            None
            if index == 0 or value is None or totals[index - 1] is None
            else value - totals[index - 1]
            for index, value in enumerate(totals)
        ]
    trend_series["follow"] = [
        _get(follower_exact.get(day), "new_follow_count") for day in dates
    ]
    trend_metric_modes = {
        "read": "daily_increment",
        "share": "daily_increment",
        "like": "snapshot_delta",
        "favorite": "snapshot_delta",
        "comment": "snapshot_delta",
        "wow": "snapshot_delta",
        "follow": "daily_increment",
    }

    recent_publish_start = end - _timedelta(days=29)

    def _article_daily_series(article_id):
        rows = metrics_by_article.get(article_id, [])
        exact_dates = {item[0] for item in rows}
        series = {"dates": [day.strftime("%m-%d") for day in dates]}
        channel_values = daily_channels_by_article.get(article_id, {})
        for code, field in metric_fields.items():
            if code in ("read", "share") and channel_values.get(code):
                series[code] = [channel_values[code].get(day) for day in dates]
                continue
            values = []
            for day in dates:
                if day not in exact_dates:
                    values.append(None)
                    continue
                current_row = _metric_as_of(article_id, day)
                prior_row = _metric_as_of(article_id, day - _timedelta(days=1))
                current_value = _get(current_row, field)
                prior_value = _get(prior_row, field)
                values.append(
                    None
                    if current_value is None or prior_value is None
                    else current_value - prior_value
                )
            series[code] = values
        return series

    works = []
    cascade_articles = []
    for article_id, article in article_by_id.items():
        current = snapshots.get(article_id, {}).get(0)
        prior = snapshots.get(article_id, {}).get(1)
        published = str(_get(article, "publish_time") or "")
        published_date = _to_date(published)
        deltas = {}
        for code, field in metric_fields.items():
            current_value = _get(current, field)
            prior_value = _get(prior, field)
            deltas[code] = (
                None
                if current_value is None or prior_value is None
                else current_value - prior_value
            )
        reasons = []
        if (
            published_date is not None
            and recent_publish_start <= published_date <= end
        ):
            reasons.append("近30天发布作品")
        if any(value not in (None, 0) for value in deltas.values()):
            reasons.append("今日有数据波动")
        collection_id = _get(article, "collection_id")
        collection = collection_by_id.get(collection_id)
        collection_name = _get(collection, "collection_name")
        if collection_name == "无合集":
            collection_id = None
            collection_name = None
        work = {
            "article_id": article_id,
            "title": _get(article, "title"),
            "url": _get(article, "url") or _get(article, "canonical_url"),
            "publish_time": published,
            "collection_id": collection_id,
            "collection_name": collection_name,
            "metrics": {
                code: _get(current, field) for code, field in metric_fields.items()
            },
            "deltas_1d": deltas,
            "daily_series": _article_daily_series(article_id),
            "selection_reasons": reasons,
        }
        cascade_articles.append(work)
        if reasons:
            works.append(work)
    works.sort(key=lambda item: item["metrics"].get("read") or -1, reverse=True)

    cascade_collections = []
    for collection_id, collection in collection_by_id.items():
        collection_name = _get(collection, "collection_name")
        if not collection_name or collection_name == "无合集":
            continue
        cascade_collections.append({
            "collection_id": collection_id,
            "collection_name": collection_name,
        })
    cascade_collections.sort(
        key=lambda item: (str(item["collection_name"]), str(item["collection_id"]))
    )
    cascade_manifest = {
        "expected_collections": cascade_collections,
        "expected_articles": cascade_articles,
    }

    latest_channels = {}
    for row in channels:
        if _get(row, "metric_mode") != "cumulative":
            continue
        article_id = _get(row, "article_id")
        channel = _get(row, "channel")
        stat_date = _to_date(_get(row, "stat_date"))
        if article_id is None or not channel or stat_date is None:
            continue
        key = (article_id, channel)
        previous = latest_channels.get(key)
        if previous is None or stat_date > previous[0]:
            latest_channels[key] = (stat_date, row)
    channel_totals = {}
    channel_metric_mode = "cumulative"
    for (_article_id, channel), (_stat_date, row) in latest_channels.items():
        if channel == "全部":
            continue
        channel_totals[channel] = channel_totals.get(channel, 0) + (
            _get(row, "read_count") or 0
        )
    if not channel_totals:
        channel_metric_mode = "period_increment"
        for row in channels:
            if _get(row, "metric_mode") != "daily_increment":
                continue
            channel = _get(row, "channel")
            stat_date = _to_date(_get(row, "stat_date"))
            if not channel or channel == "全部" or stat_date is None:
                continue
            if start <= stat_date <= end:
                channel_totals[channel] = channel_totals.get(channel, 0) + (
                    _get(row, "read_count") or 0
                )
    channel_sum = sum(channel_totals.values())
    channel_summary = (
        {
            "metric_mode": channel_metric_mode,
            "data_as_of": str(end),
            "channels": [
                {
                    "channel": channel,
                    "read_count": value,
                    "share": None if channel_sum == 0 else value / channel_sum,
                }
                for channel, value in sorted(
                    channel_totals.items(), key=lambda item: item[1], reverse=True
                )
            ],
        }
        if channel_totals
        else None
    )

    publish_groups = {}
    for article_id, article in article_by_id.items():
        published = str(_get(article, "publish_time") or "")
        try:
            published_dt = _datetime.fromisoformat(published.replace("Z", "+00:00"))
        except ValueError:
            continue
        read_count = _get(snapshots.get(article_id, {}).get(0), "read_count")
        if read_count is None:
            continue
        key = f"{published_dt.weekday()}-{published_dt.hour:02d}"
        group = publish_groups.setdefault(key, {
            "weekday": published_dt.weekday(),
            "hour": published_dt.hour,
            "article_count": 0,
            "total_read_count": 0,
        })
        group["article_count"] += 1
        group["total_read_count"] += read_count
    publish_time_summary = None
    if publish_groups:
        groups = [
            {
                **group,
                "display_label": (
                    f"{('周一', '周二', '周三', '周四', '周五', '周六', '周日')[group['weekday']]} "
                    f"{group['hour']:02d}:00"
                ),
                "average_read_count": (
                    group["total_read_count"] / group["article_count"]
                ),
            }
            for group in publish_groups.values()
        ]
        groups.sort(key=lambda item: item["average_read_count"], reverse=True)
        publish_time_summary = {"data_as_of": str(end), "groups": groups}

    missing = []
    if current_follower_row is None:
        missing.append("follower_summary")
    if not articles:
        missing.append("works")
    if not metrics:
        missing.extend(["metric_cards", "trend_series"])
    if channel_summary is None:
        missing.append("channel_summary")
    if publish_time_summary is None:
        missing.append("publish_time_summary")

    return _result({
        "success": True,
        "account": {
            "projectId": project_id,
            "account_code": account_code,
            "account_name": account_name,
            "platform": "公众号",
            "home_url": params.get("home_url"),
        },
        "period": {
            "report_date": str(report_date),
            "data_as_of": str(end),
            "period_start": str(start),
            "period_end": str(end),
        },
        "follower_summary": follower_summary,
        "metric_cards": metric_cards,
        "trend_series": trend_series,
        "trend_metric_modes": trend_metric_modes,
        "works": works,
        "cascade_manifest": cascade_manifest,
        "channel_summary": channel_summary,
        "publish_time_summary": publish_time_summary,
        "missing_outputs": sorted(set(missing)),
    })
