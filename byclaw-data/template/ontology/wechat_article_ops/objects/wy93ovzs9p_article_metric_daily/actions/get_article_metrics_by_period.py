"""获取累计快照，并以渠道增量和精确快照边界生成周期事实。"""


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
        if isinstance(value, str) and len(value) >= 10:
            try:
                return _date.fromisoformat(value[:10])
            except ValueError:
                return None
        return None

    def _parse_date_param(value):
        if not isinstance(value, str) or len(value) != 10:
            return None
        try:
            return _date.fromisoformat(value)
        except ValueError:
            return None

    def _add_months(value, months):
        month_index = value.month - 1 + months
        year = value.year + month_index // 12
        month = month_index % 12 + 1
        day = min(value.day, _calendar.monthrange(year, month)[1])
        return _date(year, month, day)

    def _get(entity, key, default=None):
        if entity is None:
            return default
        return entity.get(key, default) if isinstance(entity, dict) else getattr(entity, key, default)

    async def _fetch_pages(mapper, build_query, total, batch_size=200):
        rows = []
        page_number = 1
        while len(rows) < total:
            page_result = await mapper.select(build_query().page(page_number, batch_size))
            batch = page_result.get("records", [])
            if not batch:
                break
            rows.extend(batch)
            page_number += 1
        return rows[:total]

    project_id = str(params.get("projectId") or "").strip()
    account_code = str(params.get("account_code") or "").strip()
    if not project_id:
        return _error("PROJECT_ID_REQUIRED", "projectId不能为空")
    if not account_code:
        return _error("ACCOUNT_CODE_REQUIRED", "account_code不能为空")

    start = _parse_date_param(params.get("stat_date_from"))
    end = _parse_date_param(params.get("stat_date_to"))
    if start is None or end is None or start > end:
        return _error("INVALID_DATE_RANGE", "stat_date_from/stat_date_to必须使用YYYY-MM-DD格式且日期范围为正序")
    if end > _add_months(start, 3):
        return _error("DATE_RANGE_TOO_LARGE", "统计日期范围最多3个自然月，请缩短日期范围")

    raw_ids = params.get("article_ids")
    article_ids = None
    if raw_ids is not None:
        if (not isinstance(raw_ids, list) or not raw_ids
                or any(type(value) is not int for value in raw_ids)):
            return _error("INVALID_ARGUMENT", "article_ids必须是非空整数数组")
        article_ids = sorted(set(raw_ids))
        if len(article_ids) > 500:
            return _error("TOO_MANY_ARTICLE_IDS", "article_ids最多500个，请分批查询")

    try:
        page = int(params.get("page", 1))
        page_size = int(params.get("page_size", 50))
    except (TypeError, ValueError):
        return _error("INVALID_ARGUMENT", "page/page_size必须是整数")
    if page < 1 or not 1 <= page_size <= 200:
        return _error("INVALID_ARGUMENT", "page必须>=1且page_size必须在1到200之间")

    MF = Wy93ovzs9pArticleMetricDaily.F

    def _raw_query():
        query = (Q.eq(MF.projectId, project_id).eq(MF.account_code, account_code)
                 .gte(MF.stat_date, start).lte(MF.stat_date, end))
        if article_ids is not None:
            query = query.in_(MF.article_id, article_ids)
        return (query.order_by(MF.stat_date, desc=True)
                .order_by(MF.article_id, desc=False).order_by(MF.id, desc=False))

    total_matched = await wy93ovzs9p_article_metric_daily_mapper.count(_raw_query())
    metric_page = await wy93ovzs9p_article_metric_daily_mapper.select(
        _raw_query().page(page, page_size)
    )
    metrics = metric_page.get("records", [])
    aggregate_returned = page == 1
    boundary_start = start - timedelta(days=1)
    history_rows = []
    channel_rows = []

    if aggregate_returned:
        def _history_query():
            query = (Q.eq(MF.projectId, project_id).eq(MF.account_code, account_code)
                     .gte(MF.stat_date, boundary_start).lte(MF.stat_date, end))
            if article_ids is not None:
                query = query.in_(MF.article_id, article_ids)
            return (query.order_by(MF.article_id, desc=False)
                    .order_by(MF.stat_date, desc=False).order_by(MF.id, desc=False))

        history_total = await wy93ovzs9p_article_metric_daily_mapper.count(_history_query())
        if history_total > MAX_AGGREGATE_ROWS:
            return _error("RESULT_TOO_LARGE", "累计快照超过50000行，请缩短日期范围或使用article_ids缩小范围")
        history_rows = await _fetch_pages(
            wy93ovzs9p_article_metric_daily_mapper, _history_query, history_total
        )
        if len(history_rows) != history_total:
            return _error("INCOMPLETE_PAGE", "指标边界数据分页未完整返回，请稍后重试")

        CF = Wy93ovzs9pArticleChannelDaily.F

        def _channel_query():
            query = (Q.eq(CF.projectId, project_id).eq(CF.account_code, account_code)
                     .eq(CF.metric_mode, "daily_increment")
                     .gte(CF.stat_date, start).lte(CF.stat_date, end))
            if article_ids is not None:
                query = query.in_(CF.article_id, article_ids)
            return (query.order_by(CF.article_id, desc=False)
                    .order_by(CF.stat_date, desc=False).order_by(CF.id, desc=False))

        channel_total = await wy93ovzs9p_article_channel_daily_mapper.count(_channel_query())
        if channel_total > MAX_AGGREGATE_ROWS:
            return _error("RESULT_TOO_LARGE", "渠道指标超过50000行，请缩短日期范围或使用article_ids缩小范围")
        channel_rows = await _fetch_pages(
            wy93ovzs9p_article_channel_daily_mapper, _channel_query, channel_total
        )
        if len(channel_rows) != channel_total:
            return _error("INCOMPLETE_PAGE", "渠道数据分页未完整返回，请稍后重试")

    candidate_ids = {
        _get(row, "article_id") for row in metrics + history_rows + channel_rows
        if _get(row, "article_id") is not None
    }
    if article_ids is not None:
        candidate_ids.update(article_ids)
    candidate_ids = sorted(candidate_ids)
    if len(candidate_ids) > 5000:
        return _error("TOO_MANY_ARTICLES", "聚合涉及文章超过5000篇，请缩短日期范围或使用article_ids缩小范围")
    articles = []
    AF = Wy93ovzs9pArticle.F
    for offset in range(0, len(candidate_ids), 200):
        id_batch = candidate_ids[offset:offset + 200]
        article_query = (Q.eq(AF.projectId, project_id).eq(AF.account_code, account_code)
                         .in_(AF.id, id_batch).limit(len(id_batch)))
        articles.extend((await wy93ovzs9p_article_mapper.select(article_query)).get("records", []))
    article_by_id = {_get(row, "id"): row for row in articles}

    metric_fields = (
        "read_count", "avg_stay_sec", "finish_rate", "new_follow_count",
        "share_count", "wow_count", "like_count", "favorite_count",
        "comment_count", "deliver_count", "msg_read_count", "first_share_count",
        "share_driven_read", "listen_full_count", "reward_points", "open_rate",
        "share_rate", "follow_rate", "virality_factor", "metric_rule_version",
    )
    items = []
    for metric in metrics:
        article_id = _get(metric, "article_id")
        article = article_by_id.get(article_id)
        item = {
            "article_id": article_id, "title": _get(article, "title"),
            "publish_time": _get(article, "publish_time"), "url": _get(article, "url"),
            "stat_date": str(_get(metric, "stat_date")),
        }
        item.update({field: _get(metric, field) for field in metric_fields})
        items.append(item)

    changes_by_article = []
    change_summary = None
    if aggregate_returned:
        calculation_ids = article_ids if article_ids is not None else candidate_ids
        history_by_article = {value: [] for value in calculation_ids}
        channel_by_article = {value: [] for value in calculation_ids}
        for row in history_rows:
            if _get(row, "article_id") in history_by_article:
                history_by_article[_get(row, "article_id")].append(row)
        for row in channel_rows:
            if _get(row, "article_id") in channel_by_article:
                channel_by_article[_get(row, "article_id")].append(row)

        counter_fields = (
            "new_follow_count", "wow_count", "like_count", "favorite_count",
            "comment_count", "deliver_count", "msg_read_count", "first_share_count",
            "share_driven_read", "listen_full_count", "reward_points",
        )
        ending_value_fields = (
            "avg_stay_sec", "finish_rate", "open_rate", "share_rate",
            "follow_rate", "virality_factor",
        )
        for article_id in calculation_ids:
            article = article_by_id.get(article_id)
            snapshots = sorted(
                history_by_article.get(article_id, []),
                key=lambda row: (_to_date(_get(row, "stat_date")), _get(row, "id") or 0),
            )
            exact_baseline = next((row for row in reversed(snapshots)
                                   if _to_date(_get(row, "stat_date")) == boundary_start), None)
            exact_end = next((row for row in reversed(snapshots)
                              if _to_date(_get(row, "stat_date")) == end), None)
            latest_snapshot = snapshots[-1] if snapshots else None
            publish_date = _to_date(_get(article, "publish_time"))
            logical_zero = (exact_baseline is None and publish_date is not None
                            and start <= publish_date <= end)
            snapshot_complete = exact_end is not None and (exact_baseline is not None or logical_zero)
            expected_channel_start = max(start, publish_date) if publish_date is not None else start
            expected_dates = {
                str(expected_channel_start + timedelta(days=offset))
                for offset in range((end - expected_channel_start).days + 1)
            }

            channel_summaries = {}
            observed_total_dates = set()
            observed_any_dates = set()
            for row in channel_by_article.get(article_id, []):
                row_date = str(_to_date(_get(row, "stat_date")))
                observed_any_dates.add(row_date)
                channel = _get(row, "channel")
                if channel == "全部":
                    observed_total_dates.add(row_date)
                summary = channel_summaries.setdefault(channel, {
                    "channel": channel, "read_count": 0, "share_count": 0,
                    "missing_read_count": 0, "missing_share_count": 0,
                })
                for field in ("read_count", "share_count"):
                    value = _get(row, field)
                    if value is None:
                        summary["missing_" + field] += 1
                    else:
                        summary[field] += value
            for summary in channel_summaries.values():
                if summary["missing_read_count"]:
                    summary["read_count"] = None
                if summary["missing_share_count"]:
                    summary["share_count"] = None
            channel_breakdown = [channel_summaries[key] for key in sorted(
                channel_summaries, key=lambda value: (value != "全部", value or ""))]
            total_channel = channel_summaries.get("全部")
            missing_channel_dates = sorted(expected_dates - observed_total_dates)
            if not observed_any_dates:
                channel_status = "no_channel_data"
            elif total_channel is None:
                channel_status = "detail_only_no_total"
            elif missing_channel_dates:
                channel_status = "sparse_or_missing_days"
            else:
                channel_status = "complete_dates"

            counter_changes = {}
            for field in counter_fields:
                end_value = _get(exact_end, field)
                baseline_value = 0 if logical_zero else _get(exact_baseline, field)
                counter_changes[field] = (
                    end_value - baseline_value
                    if snapshot_complete and baseline_value is not None and end_value is not None
                    else None
                )
            channel_period_complete = channel_status == "complete_dates"
            observed_read_share = {
                "read_count": _get(total_channel, "read_count"),
                "share_count": _get(total_channel, "share_count"),
            }
            counter_changes["read_count"] = (
                observed_read_share["read_count"] if channel_period_complete else None
            )
            counter_changes["share_count"] = (
                observed_read_share["share_count"] if channel_period_complete else None
            )

            if exact_end is None:
                snapshot_status = "end_snapshot_missing"
            elif logical_zero:
                snapshot_status = "new_article_zero_baseline"
            elif exact_baseline is not None:
                snapshot_status = "exact_boundary"
            else:
                snapshot_status = "baseline_missing"
            latest_date = _to_date(_get(latest_snapshot, "stat_date"))
            coverage_status = (
                "complete" if snapshot_complete and channel_status == "complete_dates" else "partial"
            )
            changes_by_article.append({
                "article_id": article_id, "title": _get(article, "title"),
                "requested_period": {"start": str(start), "end": str(end)},
                "effective_period": {
                    "start": str(publish_date if logical_zero else start) if snapshot_complete else None,
                    "end": str(end) if snapshot_complete else None,
                },
                "observed_snapshot_period": {
                    "start": str(_to_date(_get(snapshots[0], "stat_date"))) if snapshots else None,
                    "end": str(latest_date) if latest_date is not None else None,
                },
                "baseline_stat_date": str(boundary_start) if exact_baseline is not None else None,
                "end_stat_date": str(latest_date) if latest_date is not None else None,
                "end_gap_days": (end - latest_date).days if latest_date is not None else None,
                "missing_snapshot_boundaries": [
                    name for name, missing in (
                        ("period_start_previous_day", exact_baseline is None and not logical_zero),
                        ("period_end", exact_end is None),
                    ) if missing
                ],
                "snapshot_status": snapshot_status, "channel_status": channel_status,
                "coverage_status": coverage_status, "counter_changes": counter_changes,
                "observed_read_share": observed_read_share,
                "ending_values": {field: _get(latest_snapshot, field) for field in ending_value_fields},
                "read_share_source": "channel_daily_increment",
                "channel_observed_total_dates": sorted(observed_total_dates),
                "channel_missing_calendar_dates": missing_channel_dates,
                "channel_breakdown": channel_breakdown,
            })

        if changes_by_article:
            summary_fields = ("read_count", "share_count") + counter_fields
            summary_changes = {field: 0 for field in summary_fields}
            missing_counts = {field: 0 for field in summary_fields}
            for change in changes_by_article:
                for field, value in change["counter_changes"].items():
                    if value is None:
                        missing_counts[field] += 1
                    else:
                        summary_changes[field] += value
            for field, missing_count in missing_counts.items():
                if missing_count:
                    summary_changes[field] = None
            change_summary = {
                "counter_changes": summary_changes, "missing_article_counts": missing_counts,
                "article_count": len(changes_by_article),
                "complete_article_count": sum(item["coverage_status"] == "complete"
                                              for item in changes_by_article),
            }

    has_any_channel_data = any(item["channel_status"] != "no_channel_data"
                               for item in changes_by_article)
    return _result({
        "success": True,
        "data_status": "available" if total_matched or has_any_channel_data else "no_data",
        "period": {"stat_date_from": str(start), "stat_date_to": str(end)},
        "items": items, "changes_by_article": changes_by_article,
        "change_summary": change_summary, "change_scope": "all_target_articles",
        "aggregate_returned": aggregate_returned,
        "non_additive_rule": "比例和均值不得作差；ending_values仅返回已观测的最近快照值",
        "snapshot_gap_rule": "中间日期缺快照不影响边界差值；缺期初前一日或期末快照时累计计数变化返回null",
        "read_share_source": "read_count/share_count来自article_channel_daily中daily_increment且channel=全部；缺日期时仅为已观测日合计",
        "total_matched": total_matched, "page": page, "page_size": page_size,
        "missing_article_ids": [value for value in (article_ids or []) if value not in article_by_id],
    })
