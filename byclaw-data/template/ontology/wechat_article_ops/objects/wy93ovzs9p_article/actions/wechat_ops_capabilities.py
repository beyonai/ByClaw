async def execute(params: dict) -> dict:
    project_id = str(params.get("projectId") or "").strip()
    if not project_id:
        return {"records": [{"success": False, "code": "PROJECT_ID_REQUIRED", "error": "projectId不能为空"}], "total": 1, "meta": {"total": 1}}
    capabilities = {
        "metric_granularity": "day",
        "article_metric_mode": "daily_full",
        "profile_mode": "daily_full",
        "channel_metric_modes": ["cumulative", "daily_increment"],
        "channels": ["公众号会话", "朋友圈", "搜一搜", "公众号主页", "聊天会话", "推荐", "其他"],
        "report_types": ["single", "weekly", "collection", "assets", "account_ops"],
        "account_follower_mode": "daily_full",
        "account_report_template": "account-ops-v2",
        "metric_rule_version": "1.0"
    }
    return {
        "records": [{"success": True, "capabilities": capabilities}],
        "total": 1,
        "meta": {"columns": [{"name": "success"}, {"name": "capabilities"}], "total": 1}
    }
