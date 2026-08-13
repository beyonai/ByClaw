# 网页阅读

通用网页和 RSS。

## 通用网页（byCLI）

所有网站、网页或 URL 的打开、读取、站内搜索、采集、抓取或操作只能交给 `bycli` skill。先运行
`bycli list -f json` 动态发现站点 Adapter；存在专用 Adapter 时优先使用，缺失时按 `bycli` skill 的 `bycli browser`
流程执行。公开静态页、SPA、raw URL、纯文本、Markdown 和无需登录的页面均不是例外。

不得使用 `web_fetch`、Jina Reader、Web Reader MCP、通用 `browser`、直接 HTTP 客户端或原站直连试读。byCLI 无法完成时停止并报告，
不得切换到其他网页读取后端。

## RSS (feedparser)

```python
python3 -c "
import feedparser
for e in feedparser.parse('FEED_URL').entries[:5]:
    print(f'{e.title} — {e.link}')
"
```

**适用场景**: 订阅博客、新闻源、播客等 RSS feed。

## 选择指南

| 场景 | 推荐工具 |
|-----|---------|
| 通用网页 | byCLI Adapter；缺失时使用 `bycli browser` |
| 需要图片/格式控制 | byCLI Adapter 或 `bycli browser` |
| RSS 订阅 | feedparser |
