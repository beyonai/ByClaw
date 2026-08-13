# 网页与 RSS

所有网站、网页或 URL 的打开、读取、站内搜索、采集、抓取或操作，先加载并遵循 `bycli` skill，再执行：

```bash
bycli web read --url <URL> --stdout
```

这是唯一的通用网页路径。静态页、SPA、raw URL、纯文本、Markdown 和无需登录页面均无例外。byCLI 失败即停止并报告；不得使用其他网页读取工具。

RSS 不是具体网页读取时可用 `feedparser`：

```python
import feedparser
feedparser.parse("FEED_URL")
```
