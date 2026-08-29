async def execute(params: dict) -> dict:
    project_id = str(params.get("projectId") or "").strip()
    if not project_id:
        return {"records": [{"success": False, "code": "PROJECT_ID_REQUIRED", "error": "projectId不能为空"}], "total": 1, "meta": {"total": 1}}
    import json as _json
    from datetime import date as _date, datetime as _datetime

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

    def _response(row):
        return {"records": [row], "total": 1,
                "meta": {"columns": [{"name": k} for k in row], "total": 1}}

    account_code = str(params.get("account_code") or "").strip()
    account_name = str(params.get("account_name") or "").strip()
    if not account_code: return _response({"success": False, "code": "ACCOUNT_CODE_REQUIRED", "error": "account_code不能为空"})
    if not account_name: return _response({"success": False, "code": "ACCOUNT_NAME_REQUIRED", "error": "account_name不能为空"})
    items = params.get("items") or []
    if isinstance(items, str):
        try: items = _json.loads(items)
        except (TypeError, ValueError): items = None
    if not isinstance(items, list) or not items:
        return _response({"success": False, "code": "INVALID_ITEMS", "error": "items必须是非空数组"})

    F = Wy93ovzs9pAccountFollowerDaily.F
    inserted = updated = failed = 0
    errors = []
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            failed += 1; errors.append({"index": index, "code": "INVALID_ITEM"}); continue
        stat_date = _to_date(item.get("stat_date"))
        values = {name: item.get(name) for name in (
            "new_follow_count", "unfollow_count", "net_follow_count", "follower_count")}
        if stat_date is None or values["follower_count"] is None:
            failed += 1; errors.append({"index": index, "code": "MISSING_REQUIRED_FIELDS"}); continue
        if any(value is not None and (not isinstance(value, int) or value < 0)
               for name, value in values.items() if name != "net_follow_count"):
            failed += 1; errors.append({"index": index, "code": "INVALID_COUNT"}); continue
        if values["net_follow_count"] is not None and not isinstance(values["net_follow_count"], int):
            failed += 1; errors.append({"index": index, "code": "INVALID_NET_COUNT"}); continue
        if values["new_follow_count"] is not None and values["unfollow_count"] is not None:
            expected = values["new_follow_count"] - values["unfollow_count"]
            if values["net_follow_count"] is not None and values["net_follow_count"] != expected:
                failed += 1; errors.append({"index": index, "code": "NET_FOLLOW_MISMATCH"}); continue
        values.update({"projectId": project_id,
            "account_code": account_code, "account_name": account_name,
                       "stat_date": stat_date,
                       "source_batch_id": params.get("source_batch_id"),
                       "collected_at": params.get("collected_at")})
        q = Q.eq(F.projectId, project_id).eq(F.account_code, account_code).eq(F.stat_date, stat_date)
        entity = await wy93ovzs9p_account_follower_daily_mapper.select_one(q)
        if entity:
            values["id"] = _get(entity, "id")
            ok = await wy93ovzs9p_account_follower_daily_mapper.update_by_id(
                Wy93ovzs9pAccountFollowerDaily(**values))
            if ok: updated += 1
            else: failed += 1; errors.append({"index": index, "code": "UPDATE_FAILED"})
        else:
            await wy93ovzs9p_account_follower_daily_mapper.insert(
                Wy93ovzs9pAccountFollowerDaily(**values))
            inserted += 1
    return _response({"success": failed == 0, "inserted": inserted,
                      "updated": updated, "failed": failed, "errors": errors})
