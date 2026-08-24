"""按文章标题模糊 + 发布时间范围 + 规范化链接 检索
入参：title_keyword(可选, 模糊匹配)、published_from(可选, ISO 字符串)、published_to(可选, ISO 字符串)、
       canonical_url(可选, 精确匹配)、page(默认 1)、page_size(默认 20，上限 200)
返回：items 每项为 {article_id, title, publish_time, canonical_url, url} + 分页信息
关键约束：
- title_keyword / published_from / published_to / canonical_url 四者至少需要有一个，否则无意义直接报 INVALID_ARGUMENT
- publish_time 字段类型为 STRING（如 2026-08-10T09:00:00+08:00），用字符串字典序比较即可
- published_from <= published_to，违反则报 INVALID_DATE_RANGE
- canonical_url 用精确匹配（Q.eq），符合规范化唯一链接的语义
- LIKE 用 escape=backslash，title_keyword 里的 %/_ 视作字面量
- 排序：按 publish_time 倒序 + id 倒序（id 倒序作为 tiebreaker 保证稳定排序）
注意：q = Q 作为起点，不要用 Q.eq(F.id, F.id) 占位，否则会被 mapper 当作真实条件过滤掉"""
async def execute(params: dict) -> dict:
    import json as _json

    def _err(code, message):
        return {"records": [{"success": False, "code": code, "error": message}],
                "total": 1,
                "meta": {"columns": [{"name": "success"}, {"name": "code"},
                                     {"name": "error"}], "total": 1}}

    # 1. 入参解析
    raw_kw = params.get("title_keyword")
    title_keyword = str(raw_kw).strip() if raw_kw is not None else ""

    published_from = params.get("published_from")
    published_to = params.get("published_to")
    if published_from is not None:
        published_from = str(published_from).strip() or None
    if published_to is not None:
        published_to = str(published_to).strip() or None

    raw_canonical = params.get("canonical_url")
    canonical_url = str(raw_canonical).strip() if raw_canonical is not None else ""

    if not title_keyword and not published_from and not published_to and not canonical_url:
        return _err("INVALID_ARGUMENT",
                    "title_keyword / published_from / published_to / canonical_url 至少需要提供一个")

    if published_from and published_to and published_from > published_to:
        return _err("INVALID_DATE_RANGE", "published_from 必须 <= published_to")

    try:
        page = int(params.get("page", 1))
    except (TypeError, ValueError):
        return _err("INVALID_ARGUMENT", "page 必须为整数")
    if page < 1:
        return _err("INVALID_ARGUMENT", "page 必须 >= 1")

    try:
        page_size = int(params.get("page_size", 20))
    except (TypeError, ValueError):
        return _err("INVALID_ARGUMENT", "page_size 必须为整数")
    if page_size < 1:
        page_size = 20
    if page_size > 200:
        page_size = 200

    F = Wy93ovzs9pArticle.F

    # 2. 构造条件：q = Q 作为起点，逐步链式累加
    q = Q
    if title_keyword:
        safe_kw = title_keyword.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        q = q.like(F.title, f"%{safe_kw}%")
    if published_from:
        q = q.gte(F.publish_time, published_from)
    if published_to:
        q = q.lte(F.publish_time, published_to)
    if canonical_url:
        q = q.eq(F.canonical_url, canonical_url)

    # 3. 先 count 命中总数（count 不需要分页/排序）
    total_matched = await wy93ovzs9p_article_mapper.count(q)

    # 4. 分页 + 排序
    q = q.order_by(F.publish_time, desc=True).order_by(F.id, desc=True).page(page, page_size)
    page_result = await wy93ovzs9p_article_mapper.select(q)
    rows = page_result.get("records", [])

    items = [{
        "article_id": r.get("id"),
        "title": r.get("title"),
        "publish_time": r.get("publish_time"),
        "canonical_url": r.get("canonical_url"),
        "url": r.get("url"),
    } for r in rows]

    return {
        "records": [{
            "success": True,
            "items": items,
            "total": len(items),
            "total_matched": total_matched,
            "page": page,
            "page_size": page_size,
        }],
        "total": 1,
        "meta": {
            "columns": [
                {"name": "success"}, {"name": "items"},
                {"name": "total"}, {"name": "total_matched"},
                {"name": "page"}, {"name": "page_size"},
            ],
            "total": 1,
        },
    }