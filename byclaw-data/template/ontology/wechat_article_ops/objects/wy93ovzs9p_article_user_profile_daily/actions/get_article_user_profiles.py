"""获取文章画像；支持日期范围明细或截至日期的逐文章最近快照。"""


async def execute(params: dict) -> dict:
    import asyncio as _asyncio
    import json as _json
    from datetime import date as _date, datetime as _datetime

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
        if isinstance(value, str):
            if len(value) != 10:
                return None
            try:
                return _date.fromisoformat(value)
            except ValueError:
                return None
        return None

    def _get(entity, key, default=None):
        return entity.get(key, default) if isinstance(entity, dict) else getattr(entity, key, default)

    def _distribution(value):
        if not isinstance(value, str):
            return value
        try:
            return _json.loads(value)
        except (TypeError, ValueError):
            return value

    project_id = str(params.get("projectId") or "").strip()
    account_code = str(params.get("account_code") or "").strip()
    if not project_id:
        return _error("PROJECT_ID_REQUIRED", "projectId不能为空")
    if not account_code:
        return _error("ACCOUNT_CODE_REQUIRED", "account_code不能为空")

    raw_ids = params.get("article_ids")
    if not isinstance(raw_ids, list) or not raw_ids:
        return _error("INVALID_ARGUMENT", "article_ids必须是非空整数数组")
    if any(type(value) is not int for value in raw_ids):
        return _error("INVALID_ARGUMENT", "article_ids必须是非空整数数组")
    article_ids = sorted(set(raw_ids))
    if len(article_ids) > 200:
        return _error("TOO_MANY_ARTICLES", "article_ids最多允许200个，请分批查询")

    as_of = _to_date(params.get("as_of_date")) if params.get("as_of_date") is not None else None
    start = _to_date(params.get("stat_date_from")) if params.get("stat_date_from") is not None else None
    end = _to_date(params.get("stat_date_to")) if params.get("stat_date_to") is not None else None
    if params.get("as_of_date") is not None and as_of is None:
        return _error("INVALID_DATE_RANGE", "as_of_date必须使用YYYY-MM-DD格式")
    if (start is None) != (end is None):
        return _error("INVALID_DATE_RANGE", "stat_date_from和stat_date_to必须同时提供并使用YYYY-MM-DD格式")
    if start is not None and start > end:
        return _error("INVALID_DATE_RANGE", "stat_date_from不得晚于stat_date_to")
    if as_of is not None and start is not None:
        return _error("INVALID_ARGUMENT", "as_of_date与统计日期范围不能同时提供")
    mode = "date_range" if start is not None else "latest_as_of"

    try:
        page = int(params.get("page", 1))
        page_size = int(params.get("page_size", 50))
    except (TypeError, ValueError):
        return _error("INVALID_ARGUMENT", "page/page_size必须是整数")
    if page < 1 or not 1 <= page_size <= 200:
        return _error("INVALID_ARGUMENT", "page必须>=1且page_size必须在1到200之间")

    AF = Wy93ovzs9pArticle.F
    article_query = (Q.eq(AF.projectId, project_id).eq(AF.account_code, account_code)
                     .in_(AF.id, article_ids).limit(min(len(article_ids), 5000)))
    articles = (await wy93ovzs9p_article_mapper.select(article_query)).get("records", [])
    article_by_id = {_get(row, "id"): row for row in articles}
    valid_ids = sorted(article_by_id)

    profiles = []
    total_matched = 0
    PF = Wy93ovzs9pArticleUserProfileDaily.F
    if valid_ids and mode == "date_range":
        query = (Q.eq(PF.projectId, project_id).eq(PF.account_code, account_code)
                 .in_(PF.article_id, valid_ids).gte(PF.stat_date, start).lte(PF.stat_date, end))
        total_matched = await wy93ovzs9p_article_user_profile_daily_mapper.count(query)
        query = (query.order_by(PF.stat_date, desc=True)
                 .order_by(PF.article_id, desc=False)
                 .order_by(PF.id, desc=False)
                 .page(page, page_size))
        profiles = (await wy93ovzs9p_article_user_profile_daily_mapper.select(query)).get("records", [])
    elif valid_ids:
        semaphore = _asyncio.Semaphore(20)

        async def _latest_profile(article_id):
            query = (Q.eq(PF.projectId, project_id).eq(PF.account_code, account_code)
                     .eq(PF.article_id, article_id))
            if as_of is not None:
                query = query.lte(PF.stat_date, as_of)
            query = query.order_by(PF.stat_date, desc=True).order_by(PF.id, desc=True).limit(1)
            async with semaphore:
                return await wy93ovzs9p_article_user_profile_daily_mapper.select_one(query)

        results = await _asyncio.gather(*(_latest_profile(article_id) for article_id in valid_ids))
        profiles = [profile for profile in results if profile is not None]
        total_matched = len(profiles)

    items = []
    for profile in profiles:
        article_id = _get(profile, "article_id")
        article = article_by_id.get(article_id)
        items.append({
            "article_id": article_id,
            "title": _get(article, "title"),
            "publish_time": _get(article, "publish_time"),
            "profile_stat_date": str(_get(profile, "stat_date")),
            "gender_distribution": _distribution(_get(profile, "gender_distribution")),
            "age_distribution": _distribution(_get(profile, "age_distribution")),
            "region_distribution": _distribution(_get(profile, "region_distribution")),
            "sample_size": _get(profile, "sample_size"),
        })

    returned_ids = {_get(row, "article_id") for row in profiles}
    return _result({
        "success": True,
        "mode": mode,
        "as_of_date_out": str(as_of) if as_of is not None else None,
        "period": ({"stat_date_from": str(start), "stat_date_to": str(end)}
                   if start is not None else None),
        "items": items,
        "total_matched": total_matched,
        "page": page if mode == "date_range" else 1,
        "page_size": page_size if mode == "date_range" else len(items),
        "missing_article_ids": [value for value in article_ids if value not in returned_ids],
    })
