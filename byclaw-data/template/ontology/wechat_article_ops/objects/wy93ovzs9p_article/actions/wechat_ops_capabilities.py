async def execute(params: dict) -> dict:
    capabilities = {
        "metric_granularity": "day",
        "article_metric_mode": "daily_full",
        "profile_mode": "daily_full",
        "channel_metric_modes": ["cumulative", "daily_increment"],
        "channels": ["公众号会话", "朋友圈", "搜一搜", "公众号主页", "聊天会话", "推荐", "其他"],
        "report_types": ["single", "weekly", "collection", "assets"],
        "metric_rule_version": "1.0"
    }
    return {
        "records": [{"success": True, "capabilities": capabilities}],
        "total": 1,
        "meta": {"columns": [{"name": "success"}, {"name": "capabilities"}], "total": 1}
    }