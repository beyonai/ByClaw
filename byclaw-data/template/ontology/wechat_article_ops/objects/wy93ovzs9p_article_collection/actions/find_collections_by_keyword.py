"""按合集名称模糊检索（LIKE %kw%）
入参：keyword(必填)、page(默认 1)、page_size(默认 20，上限 200)
返回：命中合集列表 + 分页信息；items 每项为 {collection_id, collection_name, collection_type}
约束：
- keyword 必填且去除首尾空白后非空
- page >= 1；page_size 在 1..200 范围
- SQL LIKE 用 escape=backslash，避免 %/_ 等用户输入污染匹配
- 按 id 倒序（最近创建的合集优先）"""
async def execute(params: dict) -> dict:
    import json as _json

    def _err(code, message):
        return {"records": [{"success": False, "code": code, "error": message}],
                "total": 1,
                "meta": {"columns": [{"name": "success"}, {"name": "code"},
                                     {"name": "error"}], "total": 1}}

    # 1. 入参校验
    raw_kw = params.get("keyword")
    if raw_kw is None:
        return _err("INVALID_ARGUMENT", "keyword 不能为空")
    keyword = str(raw_kw).strip()
    if not keyword:
        return _err("INVALID_ARGUMENT", "keyword 不能为空")

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

    F = Wy93ovzs9pArticleCollection.F

    # 2. 转义 LIKE 通配符：用户输入里的 % 和 _ 必须当字面量处理
    # 把 % 替换为 \%，把 _ 替换为 \_，并把 \ 替换为 \\（避免转义反斜杠自身）
    safe_kw = keyword.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    pattern = f"%{safe_kw}%"

    # 3. 构造查询：模糊匹配 + 分页 + 按 id 倒序
    q = (Q.like(F.collection_name, pattern)
           .order_by(F.id, desc=True)
           .page(page, page_size))

    page_result = await wy93ovzs9p_article_collection_mapper.select(q)
    rows = page_result.get("records", [])

    # 4. 投射到约定字段（裁剪无关字段）
    items = [{
        "collection_id": r.get("id"),
        "collection_name": r.get("collection_name"),
        "collection_type": r.get("collection_type"),
    } for r in rows]

    return {
        "records": [{
            "success": True,
            "items": items,
            "total": len(items),
            "page": page,
            "page_size": page_size,
        }],
        "total": 1,
        "meta": {
            "columns": [
                {"name": "success"}, {"name": "items"},
                {"name": "total"}, {"name": "page"}, {"name": "page_size"},
            ],
            "total": 1,
        },
    }