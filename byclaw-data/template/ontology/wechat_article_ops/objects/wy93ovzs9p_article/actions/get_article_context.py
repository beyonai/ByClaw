"""重写版本（按文档 16.2）：单篇文章分析上下文
变更：article_data 字段集合新增 url 和 canonical_url（对齐文档示例/业务键/报告模板）"""
async def execute(params: dict) -> dict:
    project_id = str(params.get("projectId") or "").strip()
    if not project_id:
        return {"records": [{"success": False, "code": "PROJECT_ID_REQUIRED", "error": "projectId不能为空"}], "total": 1, "meta": {"total": 1}}
    account_code = str(params.get("account_code") or "").strip()
    if not account_code:
        return {"records": [{"success": False, "code": "ACCOUNT_CODE_REQUIRED", "error": "account_code不能为空"}], "total": 1, "meta": {"total": 1}}
    import json as _json
    from datetime import date as _date, datetime as _datetime

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

    def _entity_dict(entity, fields):
        if entity is None: return None
        result = {}
        for f in fields:
            v = _get(entity, f)
            if isinstance(v, _date) and not isinstance(v, _datetime):
                v = str(v)
            elif isinstance(v, _datetime):
                v = v.isoformat()
            result[f] = v
        return result

    article_id = params.get("article_id")
    requested_date = params.get("stat_date")
    include_content = bool(params.get("include_content", True))
    if not article_id:
        return _error("INVALID_ARGUMENT", "article_id不能为空")

    article = await wy93ovzs9p_article_mapper.select_by_id(article_id)
    if not article or _get(article, "projectId") != project_id or _get(article, "account_code") != account_code:
        return _error("ARTICLE_NOT_FOUND", "文章不存在")

    MF = Wy93ovzs9pArticleMetricDaily.F
    mq = Q.eq(MF.projectId, project_id).eq(MF.account_code, account_code).eq(MF.article_id, article_id)
    if requested_date:
        mq = mq.eq(MF.stat_date, _to_date(requested_date))
    else:
        mq = mq.order_by(MF.stat_date, "desc").limit(1)
    metric = await wy93ovzs9p_article_metric_daily_mapper.select_one(mq)
    if metric is None:
        return _error("DATA_NOT_READY", "指定日期或最新文章指标不存在")
    actual_date = _to_date(_get(metric, "stat_date"))

    CF = Wy93ovzs9pArticleChannelDaily.F
    channel_query = Q.eq(CF.projectId, project_id).eq(CF.account_code, account_code).eq(CF.article_id, article_id).eq(CF.stat_date, actual_date)
    channel_page = await wy93ovzs9p_article_channel_daily_mapper.select(channel_query)
    channels = channel_page.get("records", [])
    modes = sorted({_get(row, "metric_mode") for row in channels})
    selected_mode = ("daily_increment" if "daily_increment" in modes
                     else ("cumulative" if "cumulative" in modes else None))
    channels = [row for row in channels if _get(row, "metric_mode") == selected_mode]

    PF = Wy93ovzs9pArticleUserProfileDaily.F
    profile_query = (Q.eq(PF.projectId, project_id).eq(PF.account_code, account_code).eq(PF.article_id, article_id)
                     .lte(PF.stat_date, actual_date)
                     .order_by(PF.stat_date, "desc").limit(1))
    profile = await wy93ovzs9p_article_user_profile_daily_mapper.select_one(profile_query)

    collection = None
    coll_id = _get(article, "collection_id")
    if coll_id:
        collection = await wy93ovzs9p_article_collection_mapper.select_by_id(coll_id)
        if collection is not None and (_get(collection, "projectId") != project_id or _get(collection, "account_code") != account_code):
            collection = None

    article_data = _entity_dict(article, ["id", "title", "author", "publish_time",
                                          "category", "tags", "collection_id",
                                          "url", "canonical_url",
                                          "summary", "content_text"])
    if not include_content:
        article_data.pop("content_text", None)
    if article_data.get("content_text") is not None:
        article_data["content"] = article_data["content_text"]

    raw_fields = ["deliver_count", "msg_read_count", "first_share_count",
                  "read_count", "share_count", "share_driven_read",
                  "new_follow_count", "finish_rate", "wow_count", "like_count",
                  "favorite_count", "comment_count",
                  "listen_full_count", "reward_points"]
    raw = _entity_dict(metric, raw_fields)
    record = {
        "success": True,
        "article": article_data,
        "metric": {
            "stat_date": str(actual_date),
            "data_mode": "daily_full",
            "raw_metrics": raw,
            "derived_metrics": {
                "open_rate": _safe_div(raw["msg_read_count"], raw["deliver_count"]),
                "share_rate": _safe_div(raw["share_count"], raw["read_count"]),
                "follow_rate": _safe_div(raw["new_follow_count"], raw["read_count"]),
                "message_open_rate": _safe_div(raw["msg_read_count"], raw["deliver_count"]),
                "first_share_rate": _safe_div(raw["first_share_count"], raw["msg_read_count"]),
                "share_read_efficiency": _safe_div(raw["share_driven_read"], raw["share_count"]),
            },
            "missing_fields": [k for k, v in raw.items() if v is None],
        },
        "channel_summary": {
            "stat_date": str(actual_date), "metric_mode": selected_mode,
            "items": [_entity_dict(x, ["channel", "metric_mode", "read_count",
                                       "share_count", "new_follow_count"]) for x in channels],
        },
        "profile": _entity_dict(profile, ["stat_date", "gender_distribution",
                                          "age_distribution", "region_distribution",
                                          "sample_size"]),
        "collection": _entity_dict(collection, ["id", "collection_name", "description"]),
    }
    if record["collection"] is not None:
        record["collection"]["name"] = record["collection"].pop("collection_name", None)
    return _result([record])
