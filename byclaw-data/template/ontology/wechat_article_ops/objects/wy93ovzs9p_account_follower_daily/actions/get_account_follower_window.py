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
    end = _to_date(params.get("data_as_of"))
    days = params.get("days", 30)
    if not account_code or end is None:
        return _result({"success": False, "code": "INVALID_ARGUMENT", "error": "account_code和data_as_of不能为空"})
    if not isinstance(days, int) or days < 1 or days > 90:
        return _result({"success": False, "code": "INVALID_DAYS", "error": "days必须在1到90之间"})
    F = Wy93ovzs9pAccountFollowerDaily.F

    async def _latest(target):
        q = (Q.eq(F.projectId, project_id).eq(F.account_code, account_code).lte(F.stat_date, target)
             .order_by(F.stat_date, "desc").limit(1))
        return await wy93ovzs9p_account_follower_daily_mapper.select_one(q)

    current = await _latest(end)
    snapshots = {}
    for offset in (1, 7, 30):
        snapshots[offset] = await _latest(end - _timedelta(days=offset))
    current_value = _get(current, "follower_count")
    summary = {"follower_count": current_value,
               "actual_stat_date": str(_get(current, "stat_date")) if current else None}
    for offset in (1, 7, 30):
        prior = _get(snapshots[offset], "follower_count")
        summary[f"delta_{offset}d"] = None if current_value is None or prior is None else current_value - prior

    start = end - _timedelta(days=days - 1)
    q = (Q.eq(F.projectId, project_id).eq(F.account_code, account_code).gte(F.stat_date, start).lte(F.stat_date, end)
         .order_by(F.stat_date, "asc").limit(days + 5))
    page = await wy93ovzs9p_account_follower_daily_mapper.select(q)
    records = page.get("records", [])
    by_date = {str(_get(row, "stat_date")): row for row in records}
    trend, missing = [], []
    for index in range(days):
        day = start + _timedelta(days=index)
        key = str(day); row = by_date.get(key)
        if row is None: missing.append(key)
        trend.append({"stat_date": key,
                      "follower_count": _get(row, "follower_count"),
                      "new_follow_count": _get(row, "new_follow_count"),
                      "unfollow_count": _get(row, "unfollow_count"),
                      "net_follow_count": _get(row, "net_follow_count")})
    return _result({"success": True, "summary": summary, "trend": trend,
                    "missing_dates": missing})
