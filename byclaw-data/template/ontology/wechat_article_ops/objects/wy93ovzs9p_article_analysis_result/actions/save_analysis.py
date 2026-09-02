"""重写版本：保存分析结果（含幂等 replay + review 检查）

参数平铺、review_result 保持原类型
- review_result 参数保持调用方传入的类型（None / str / dict 都可）
  - dict → 落库时 _json.dumps 序列化为字符串（与 structured_result / external_benchmarks 一致）
  - str / None → 原样落库
- article_id / collection_id 平铺（不再走 scope 嵌套）
- review 校验改为读 params["review_result"]，按下列规则判定是否通过：
  - review_result is None → 视为未通过
  - review_result 是 dict 且 dict.get("passed") truthy → 通过
  - review_result 是 str 且 .strip().lower() == "true" → 视为通过（兼容 JSON 字符串）
  - 其他情况 → 视为未通过
- status / report_format 入参保留，但脚本仍硬编码写入 "approved" / "html"，调用方传值无效
"""
async def execute(params: dict) -> dict:
    project_id = str(params.get("projectId") or "").strip()
    if not project_id:
        return {"records": [{"success": False, "code": "PROJECT_ID_REQUIRED", "error": "projectId不能为空"}], "total": 1, "meta": {"total": 1}}
    account_code = str(params.get("account_code") or "").strip()
    if not account_code:
        return {"records": [{"success": False, "code": "ACCOUNT_CODE_REQUIRED", "error": "account_code不能为空"}], "total": 1, "meta": {"total": 1}}
    import json as _json
    from datetime import date as _date, datetime as _datetime

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

    def _to_date(v):
        if v is None: return v
        if isinstance(v, _datetime): return v.date()
        if isinstance(v, _date): return v
        if isinstance(v, str):
            try: return _date.fromisoformat(v[:10])
            except ValueError: return v
        return v

    def _review_passed(rv):
        # 保持原类型：
        # - None / 空 → False
        # - dict → dict.get("passed") truthy
        # - str  → strip().lower() == "true"（兼容 'true' / 'false' / JSON 字符串）
        if rv is None:
            return False
        if isinstance(rv, dict):
            return bool(rv.get("passed"))
        if isinstance(rv, str):
            s = rv.strip().lower()
            if s == "true":
                return True
            if s == "false":
                return False
            # 尝试把 str 当 JSON 解析（兼容 '{"passed": true}'）
            try:
                obj = _json.loads(rv)
                if isinstance(obj, dict):
                    return bool(obj.get("passed"))
            except (ValueError, _json.JSONDecodeError):
                pass
            return False
        return bool(rv)

    run_id = params.get("run_id")
    review_result_raw = params.get("review_result")
    input_fingerprint = params.get("input_fingerprint")
    report_html = params.get("report_html") or ""
    account_name = str(params.get("account_name") or "").strip()
    analysis_stage = params.get("analysis_stage", "post_publish")
    if not run_id or not input_fingerprint or not report_html or not account_name:
        return _error("INVALID_ARGUMENT", "run_id、input_fingerprint和report_html不能为空")
    if not isinstance(input_fingerprint, str) or len(input_fingerprint) > 100:
        return _error("INVALID_FINGERPRINT", "input_fingerprint必须是长度不超过100的字符串")
    if analysis_stage not in ("pre_publish", "post_publish"):
        return _error("INVALID_ANALYSIS_STAGE", "analysis_stage必须是pre_publish或post_publish")
    learning_outcome = params.get("learning_outcome")
    if learning_outcome not in (None, "supported", "not_supported", "conditional", "inconclusive"):
        return _error("INVALID_LEARNING_OUTCOME", "learning_outcome取值无效")
    if params.get("report_format", "html") != "html":
        return _error("INVALID_REPORT_FORMAT", "report_format必须是html")
    if not report_html.lstrip().lower().startswith("<!doctype html>"):
        return _error("INVALID_REPORT_FORMAT", "报告必须是完整的HTML文档")
    if not _review_passed(review_result_raw):
        return _error("REVIEW_NOT_PASSED", "分析结果尚未通过审校")

    F = Wy93ovzs9pArticleAnalysisResult.F
    existing = await wy93ovzs9p_article_analysis_result_mapper.select_one(
        Q.eq(F.projectId, project_id).eq(F.account_code, account_code).eq(F.run_id, run_id))
    if existing:
        if _get(existing, "input_fingerprint") != input_fingerprint:
            return _error("IDEMPOTENCY_CONFLICT", "相同run_id对应不同输入指纹")
        return _result([{
            "success": True, "id": _get(existing, "id"), "run_id": _get(existing, "run_id"),
            "analysis_type": _get(existing, "analysis_type"),
            "article_id": _get(existing, "article_id"),
            "collection_id": _get(existing, "collection_id"),
            "status": _get(existing, "status"),
            "report_html": _get(existing, "report_html"),
            "report_format": _get(existing, "report_format"),
            "created_at": str(_get(existing, "created_at")) if _get(existing, "created_at") else None,
            "idempotent_replay": True,
        }])

    structured_result = params.get("structured_result")
    if structured_result is not None and not isinstance(structured_result, str):
        structured_result = _json.dumps(structured_result, ensure_ascii=False)
    external_benchmarks = params.get("external_benchmarks")
    if external_benchmarks is not None and not isinstance(external_benchmarks, str):
        external_benchmarks = _json.dumps(external_benchmarks, ensure_ascii=False)
    def _json_text(name):
        value = params.get(name)
        if value is not None and not isinstance(value, str):
            return _json.dumps(value, ensure_ascii=False)
        return value
    # review_result 落库规则：保持原类型，dict → json.dumps，其他原样
    if review_result_raw is not None and not isinstance(review_result_raw, str):
        review_result_value = _json.dumps(review_result_raw, ensure_ascii=False)
    else:
        review_result_value = review_result_raw

    values = {
        "projectId": project_id,
            "account_code": account_code, "account_name": account_name,
        "run_id": run_id, "analysis_type": params.get("analysis_type"),
        "analysis_stage": analysis_stage,
        "source_run_id": params.get("source_run_id"),
        "platform": params.get("platform"),
        "content_role": params.get("content_role"),
        "topic": params.get("topic"),
        "target_audience": params.get("target_audience"),
        "audience_fit_analysis": _json_text("audience_fit_analysis"),
        "recommended_publish_time": params.get("recommended_publish_time"),
        "recommended_keywords": _json_text("recommended_keywords"),
        "publishing_execution_card": _json_text("publishing_execution_card"),
        "desired_action": params.get("desired_action"),
        "tested_element": params.get("tested_element"),
        "learning_outcome": params.get("learning_outcome"),
        "article_id": params.get("article_id"),
        "collection_id": params.get("collection_id"),
        "period_start": _to_date(params.get("period_start")),
        "period_end": _to_date(params.get("period_end")),
        "stat_date": _to_date(params.get("stat_date")),
        "rating": params.get("rating"),
        "structured_result": structured_result,
        "external_benchmarks": external_benchmarks,
        "report_html": report_html, "report_format": "html",
        "agent_version": params.get("agent_version"),
        "prompt_version": params.get("prompt_version"),
        "metric_rule_version": params.get("metric_rule_version"),
        "input_fingerprint": input_fingerprint,
        "review_result": review_result_value,
        "status": "approved",
    }
    values.pop("id", None)
    saved = await wy93ovzs9p_article_analysis_result_mapper.insert(
        Wy93ovzs9pArticleAnalysisResult(**values))
    return _result([{
        "success": True, "id": _get(saved, "id"), "run_id": _get(saved, "run_id"),
        "status": _get(saved, "status"), "idempotent_replay": False,
    }])
