# 社交媒体与社区

小红书、Twitter/X、B站、V2EX、Reddit 等具体网站的搜索、打开、读取、评论采集和用户主页访问统一由 byCLI 执行。

## 执行流程

1. 运行 `byclaw-capability-doctor`，只读取 `effectiveBackend`。
2. 加载并遵循 `bycli` skill。
3. 运行 `bycli list -f json` 动态发现站点 Adapter。
4. 有专用 Adapter 时使用 Adapter；没有时使用 `bycli browser`。
5. byCLI 无法完成时停止并报告，不得切换到其他站点读取工具。

```bash
bycli list -f json
```

不得使用 `web_fetch`、Jina Reader、Web Reader MCP、通用 `browser`、OpenCLI、站点 MCP、站点 CLI、直接 HTTP、原站 API
或 Python HTTP 客户端绕过 byCLI。公开 API、静态内容、无需登录和可直接获得 JSON 均不是例外。

## 平台注意事项

### 小红书

- 搜索结果中的完整 URL 和 `xsec_token` 必须由同一 byCLI 工作流继续使用，不能用裸 note ID 猜测详情地址。
- AUTH_REQUIRED、验证码或限流时遵循 `bycli` skill 的 STOP 规则。

### Twitter/X

- 登录态、Cookie 和风控处理完全交给 byCLI Adapter 或 `bycli browser`。
- 搜索失败时按 byCLI 的 Adapter 修复/浏览器降级流程处理，不安装其他网页后端。

### B站

- 搜索、视频详情、评论、用户主页和具体页面读取使用 byCLI。
- 仅“不打开或读取具体网页”的字幕提取、已有媒体文件转录等非网页任务可按 [video.md](video.md) 使用专用媒体工具。

### V2EX

- 主题、回复、节点和用户信息使用 V2EX Adapter；缺失时使用 `bycli browser`。
- 不直接调用公开 API。

### Reddit

- 登录态和地区网络要求由 byCLI 处理。
- 匿名 JSON、PRAW、rdt-cli 或其他回退不得替代 byCLI。
