import base64 as _b64


def _b64encode(s):
    return _b64.urlsafe_b64encode(s.encode("utf-8")).decode("ascii")


def _b64decode(s):
    return _b64.urlsafe_b64decode(s.encode("ascii")).decode("utf-8")


async def execute(params: dict) -> dict:
    project_id = str(params.get("projectId") or "").strip()
    if not project_id:
        return {"records": [{"success": False, "code": "PROJECT_ID_REQUIRED", "error": "projectId不能为空"}], "total": 1, "meta": {"total": 1}}
    account_code = str(params.get("account_code") or "").strip()
    if not account_code:
        return {"records": [{"success": False, "code": "ACCOUNT_CODE_REQUIRED", "error": "account_code不能为空"}], "total": 1, "meta": {"total": 1}}
    import json as _json

    def _get(entity, key, default=None):
        if isinstance(entity, dict):
            return entity.get(key, default)
        return getattr(entity, key, default)

    F_art = Wy93ovzs9pArticle.F
    q = Q.eq(F_art.projectId, project_id).eq(F_art.account_code, account_code)

    if params.get("start"):
        q = q.gte(F_art.publish_time, str(params["start"]))
    if params.get("end"):
        q = q.lte(F_art.publish_time, str(params["end"]) + "T23:59:59+08:00")
    if params.get("collection_id") is not None:
        q = q.eq(F_art.collection_id, int(params["collection_id"]))

    categories = params.get("category")
    if isinstance(categories, list) and categories:
        q = q.in_(F_art.category, categories)

    limit = int(params.get("limit", 100))
    if limit > 200:
        limit = 200
    if limit < 1:
        limit = 1

    cursor = params.get("cursor")
    page_no = 1
    if cursor:
        try:
            offset = int(_json.loads(_b64decode(cursor))["offset"])
            page_no = (offset // limit) + 1
        except Exception:
            page_no = 1
    q = q.page(page_no, limit).order_by(F_art.publish_time, desc=True)
    rows = await wy93ovzs9p_article_mapper.select(q)
    records = rows.get("records", [])

    F_metric = Wy93ovzs9pArticleMetricDaily.F
    items = []
    for r in records:
        aid = r.get("id")
        metric = await wy93ovzs9p_article_metric_daily_mapper.select_one(
            Q.eq(F_metric.projectId, project_id).eq(F_metric.account_code, account_code).eq(F_metric.article_id, aid).order_by(F_metric.stat_date, desc=True).limit(1))
        coll = None
        if r.get("collection_id"):
            c = await wy93ovzs9p_article_collection_mapper.select_by_id(int(r["collection_id"]))
            if c and _get(c, "projectId") == project_id and _get(c, "account_code") == account_code:
                coll = {"id": c.id, "name": c.collection_name, "type": c.collection_type}
        try:
            tags = _json.loads(r.get("tags")) if isinstance(r.get("tags"), str) else (r.get("tags") or [])
        except Exception:
            tags = []
        items.append({
            "article_id": aid, "publish_time": r.get("publish_time"), "title": r.get("title"),
            "url": r.get("url"), "category": r.get("category"), "tags": tags,
            "collection": coll,
            "metric_stat_date": str(metric.stat_date) if metric and metric.stat_date else None,
            "read_count": metric.read_count if metric else None,
            "share_rate": metric.share_rate if metric else None,
            "finish_rate": metric.finish_rate if metric else None,
            "open_rate": metric.open_rate if metric else None,
            "follow_rate": metric.follow_rate if metric else None,
            "virality_factor": metric.virality_factor if metric else None,
        })

    total = len(items)
    next_cursor = None
    if total == limit and total > 0:
        current_offset = ((page_no - 1) * limit)
        next_offset = current_offset + limit
        next_cursor = _b64encode(_json.dumps({"offset": next_offset}))
    return {"records": [{"success": True, "items": items, "total": total, "next_cursor": next_cursor}],
            "total": 1,
            "meta": {"columns": [{"name": "success"}, {"name": "items"}, {"name": "total"}, {"name": "next_cursor"}],
                     "total": 1}}
