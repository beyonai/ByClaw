# 职场招聘

LinkedIn、招聘站和职位详情等具体网站的搜索、打开、读取和采集统一由 byCLI 执行。

## 执行流程

1. 加载并遵循 `bycli` skill。
2. 运行 `bycli list -f json` 动态发现 LinkedIn 或目标招聘站 Adapter。
3. 有专用 Adapter 时优先使用；缺失时使用 `bycli browser`。
4. 遇到登录、人工验证、验证码或限流时遵循 `bycli` skill 的 STOP 规则。
5. byCLI 无法完成时停止并报告。

```bash
bycli list -f json
```

不得使用 `web_fetch`、Jina Reader、Web Reader MCP、通用 `browser`、LinkedIn scraper MCP、直接 HTTP 或原站直连回退。
